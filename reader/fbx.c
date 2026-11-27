#include "ufbx.h"
#include <stdlib.h>

#define IMPORT(name) __attribute__((import_module("fbx"), import_name(#name)))
IMPORT(axes) void axes(int right, int up, int front);
IMPORT(error) void report_error(const char *text, size_t length);
IMPORT(node) void node(uint32_t index, int parent, int64_t id, const ufbx_string *name, int mesh,
    const ufbx_matrix *local, const ufbx_matrix *geometric);
IMPORT(binding) void binding(uint32_t node_index, uint32_t material);
IMPORT(material) void material(const ufbx_string *name, const ufbx_vec3 *color, const ufbx_string *path,
    const void *content, size_t size);
IMPORT(mesh) void mesh(const ufbx_string *name, size_t corners, const float *positions, const float *normals,
    const float *uvs, size_t triangles, const uint32_t *indices, const uint32_t *slots);
IMPORT(polygons) void polygons(const ufbx_string *name, size_t vertices, const ufbx_vec3 *positions,
    size_t corners, const uint32_t *vertex_indices, const float *uvs,
    size_t face_count, const ufbx_face *faces);

// FBX positions, normals and UVs can each index a different set of values.
static bool emit_mesh(ufbx_mesh *m, int mode) {
    if (mode == 2) {
        float *uvs = m->vertex_uv.exists ? calloc(m->num_indices, 2 * sizeof(float)) : NULL;
        if (m->num_indices && m->vertex_uv.exists && !uvs) return false;
        for (size_t i = 0; uvs && i < m->num_indices; i++) {
            ufbx_vec2 uv = ufbx_get_vertex_vec2(&m->vertex_uv, i);
            uvs[i*2] = uv.x; uvs[i*2+1] = uv.y;
        }
        polygons(&m->name, m->vertices.count, m->vertices.data, m->num_indices, m->vertex_indices.data,
            uvs, m->num_faces, m->faces.data);
        free(uvs);
        return true;
    }
    size_t n = mode ? m->num_indices : 0, tris = mode == 1 ? m->num_triangles : 0;
    float *positions = calloc(n, 3 * sizeof(float)), *normals = calloc(n, 3 * sizeof(float));
    float *uvs = m->vertex_uv.exists ? calloc(n, 2 * sizeof(float)) : NULL;
    uint32_t *indices = calloc(tris, 3 * sizeof(uint32_t)), *slots = calloc(tris, sizeof(uint32_t));
    bool ok = (!n || (positions && normals && (!m->vertex_uv.exists || uvs))) && (!tris || (indices && slots));
    if (ok) {
        for (size_t i = 0; i < n; i++) {
            ufbx_vec3 p = ufbx_get_vertex_vec3(&m->vertex_position, i);
            ufbx_vec3 normal = m->vertex_normal.exists ? ufbx_get_vertex_vec3(&m->vertex_normal, i) : (ufbx_vec3){0};
            for (int j = 0; j < 3; j++) { positions[i*3+j] = p.v[j]; normals[i*3+j] = normal.v[j]; }
            if (uvs) {
                ufbx_vec2 uv = ufbx_get_vertex_vec2(&m->vertex_uv, i);
                uvs[i*2] = uv.x; uvs[i*2+1] = uv.y;
            }
        }
        size_t count = 0;
        for (size_t i = 0; tris && i < m->num_faces; i++) {
            ufbx_face f = m->faces.data[i];
            if (f.num_indices < 3) continue;
            size_t added = ufbx_triangulate_face(indices + count*3, (tris-count)*3, m, f);
            uint32_t slot = m->face_material.count ? m->face_material.data[i] : 0;
            for (size_t t = 0; t < added; t++) slots[count++] = slot;
        }
        mesh(&m->name, n, positions, normals, uvs, count, indices, slots);
    }
    free(positions); free(normals); free(uvs); free(indices); free(slots);
    return ok;
}

int decode(const void *bytes, size_t size, int geometry, int original_ids) {
    ufbx_load_opts opts = {0};
    opts.file_format = UFBX_FILE_FORMAT_FBX;
    opts.ignore_animation = true;
    opts.ignore_geometry = !geometry;
    opts.ignore_embedded = geometry != 1;
    opts.generate_missing_normals = true;
    opts.retain_dom = original_ids;
    ufbx_error error;
    ufbx_scene *scene = ufbx_load_memory(bytes, size, &opts, &error);
    if (!scene) { report_error(error.description.data, error.description.length); return 0; }
    ufbx_coordinate_axes a = scene->settings.axes;
    axes(a.right, a.up, a.front);
    for (size_t i = 0; i < scene->nodes.count; i++) {
        ufbx_node *n = scene->nodes.data[i];
        if (n->is_root) continue;
        const ufbx_dom_node *dom = n->element.dom_node;
        int64_t id = dom && dom->values.count ? dom->values.data[0].value_int : n->typed_id;
        node(n->typed_id, n->parent->is_root ? -1 : (int)n->parent->typed_id, id, &n->name,
            n->mesh ? (int)n->mesh->typed_id : -1, &n->node_to_parent, &n->geometry_to_node);
        for (size_t j = 0; j < n->materials.count; j++) binding(n->typed_id, n->materials.data[j]->typed_id);
    }
    for (size_t i = 0; geometry == 1 && i < scene->materials.count; i++) {
        ufbx_material *m = scene->materials.data[i];
        ufbx_material_map *diffuse = &m->fbx.diffuse_color;
        ufbx_texture *t = diffuse->texture;
        const ufbx_vec3 grey = { .x = .8, .y = .8, .z = .8 };
        material(&m->name, diffuse->has_value ? &diffuse->value_vec3 : &grey,
            t ? &t->relative_filename : NULL, t ? t->content.data : NULL, t ? t->content.size : 0);
    }
    bool ok = true;
    for (size_t i = 0; ok && i < scene->meshes.count; i++) ok = emit_mesh(scene->meshes.data[i], geometry);
    ufbx_free_scene(scene);
    return ok;
}
