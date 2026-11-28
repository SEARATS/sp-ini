import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from "three";
import type { ElevatorPose, EntityPart, Vector } from "./entity-model";

function unityRotation(rotation:Vector) {
  const [x,y,z]=rotation.map(MathUtils.degToRad);
  return new Quaternion().setFromEuler(new Euler(x,y,z,"YXZ"));
}

// Unity uses spherical interpolation for smooth full-vector positions and SmoothStep for individual axes.
function sphericalPosition(a:Vector3,b:Vector3,t:number) {
  const length=a.length(), target=b.length();
  if (!length || !target) return a.lerp(b,t);
  a.divideScalar(length); b.divideScalar(target);
  const angle=a.angleTo(b);
  if (angle>1e-6) {
    const axis=new Vector3().crossVectors(a,b);
    if (axis.lengthSq()<1e-12) axis.crossVectors(a,Math.abs(a.x)<0.9 ? new Vector3(1,0,0) : new Vector3(0,1,0));
    a.applyAxisAngle(axis.normalize(),angle*t);
  }
  return a.multiplyScalar(MathUtils.lerp(length,target,t));
}

export function sampleElevatorPose(position:Vector3, rotation:Quaternion, start:ElevatorPose, end:ElevatorPose, t:number) {
  const blend=end.linear ? t : MathUtils.smoothstep(t,0,1);
  const lerp=(from:Vector,to:Vector)=>from.map((v,i)=>MathUtils.lerp(v,to[i],blend)) as Vector;
  position.fromArray(lerp(start.position,end.position));
  rotation.copy(unityRotation(lerp(start.rotation,end.rotation)));
  if (end.vectorPosition && !end.linear) {
    position.copy(sphericalPosition(new Vector3(...start.position),new Vector3(...end.position),t));
  }
  if (end.quaternionRotation) {
    const a=unityRotation(start.rotation), b=unityRotation(end.rotation);
    if (end.linear) {
      const sign=a.dot(b)<0 ? -1 : 1;
      rotation.set(MathUtils.lerp(a.x,sign*b.x,t),MathUtils.lerp(a.y,sign*b.y,t),
        MathUtils.lerp(a.z,sign*b.z,t),MathUtils.lerp(a.w,sign*b.w,t)).normalize();
    } else rotation.copy(a).slerp(b,t);
  }
}

export type ElevatorMotion = "raise" | "lower";

export function timedElevatorClip(steps:ElevatorPose[]) {
  return steps.length>1 && steps.at(-1).time>0 &&
    steps.every((step,i)=>Number.isFinite(step.time) && step.time>=0 && (!i || step.time>=steps[i-1].time)) &&
    steps.some(step=>step.position.some((v,i)=>v!==steps[0].position[i]) || step.rotation.some((v,i)=>v!==steps[0].rotation[i]));
}

export function sampleElevatorClip(position:Vector3, rotation:Quaternion, steps:ElevatorPose[], time:number) {
  const i=steps.findIndex(step=>step.time>=time);
  if (i>0) {
    const a=steps[i-1], b=steps[i];
    sampleElevatorPose(position,rotation,a,b,(time-a.time)/(b.time-a.time));
  } else {
    const pose=i===0 ? steps[0] : steps.at(-1);
    position.fromArray(pose.position);
    rotation.copy(unityRotation(pose.rotation));
  }
}

function localMatrix(pose:Pick<ElevatorPose,"position"|"rotation">, scale:Vector) {
  return new Matrix4().compose(new Vector3(...pose.position),unityRotation(pose.rotation),new Vector3(...scale));
}

// EmbarkElevator reparents with worldPositionStays. Carry that same local point through the clip.
function riderTransform(board:Vector, part:EntityPart, parts:ReadonlyMap<string,EntityPart>, steps:ElevatorPose[]) {
  if (!steps.length) return;
  const parentMatrix=new Matrix4();
  for (let p=parts.get(part.parent);p && p.id!=="models";p=parts.get(p.parent))
    parentMatrix.premultiply(localMatrix(p,p.scale));
  const first=parentMatrix.clone().multiply(localMatrix(steps[0],part.scale));
  if (!first.determinant()) return;
  const passenger=new Vector3(...board).applyMatrix4(first.invert());
  return (matrix:Matrix4)=>passenger.clone().applyMatrix4(matrix).applyMatrix4(parentMatrix);
}

export function elevatorRider(board:Vector, part:EntityPart, parts:ReadonlyMap<string,EntityPart>, steps:ElevatorPose[]) {
  const carry=riderTransform(board,part,parts,steps);
  if (!carry) return;
  const scale=new Vector3(...part.scale), position=new Vector3(), rotation=new Quaternion(), local=new Matrix4();
  return (time:number):Vector=>{
    sampleElevatorClip(position,rotation,steps,time);
    return carry(local.compose(position,rotation,scale)).toArray();
  };
}

export function elevatorRidePath(board:Vector, part:EntityPart, parts:ReadonlyMap<string,EntityPart>, steps:ElevatorPose[], sample:"endpoint"|"path") {
  const carry=riderTransform(board,part,parts,steps);
  if (!carry) return;
  const path:Vector[]=[board];
  const scale=new Vector3(...part.scale), position=new Vector3(), rotation=new Quaternion(), local=new Matrix4();
  function append(matrix:Matrix4) {
    const p=carry(matrix);
    if (p.distanceToSquared(new Vector3(...path.at(-1)))>1e-18) path.push(p.toArray() as Vector);
  }
  if (sample==="endpoint") append(localMatrix(steps.at(-1),part.scale));
  else for (let i=1;i<steps.length;i++) {
    const a=steps[i-1], b=steps[i];
    const curved=(!b.linear && b.vectorPosition) || b.rotation.some((v,axis)=>v!==a.rotation[axis]);
    if (curved) for (let j=1;j<12;j++) {
      sampleElevatorPose(position,rotation,a,b,j/12);
      append(local.compose(position,rotation,scale));
    }
    append(localMatrix(b,part.scale));
  }
  return path;
}
