import { analyze } from "./analysis";

analyze(process.argv.slice(2),{},(file,issues) => {
  for (const issue of issues) {
    const {line,character}=issue.range.start;
    const severity=["","error","warning","info","hint"][issue.severity];
    console.log(`${file}(${line+1},${character+1}): ${severity} [${issue.code}] ${issue.message}`);
  }
}).then(({summary,exitCode}) => { console.log(summary); process.exitCode=exitCode; })
  .catch(error => { console.error(error.message); process.exitCode = 2; });
