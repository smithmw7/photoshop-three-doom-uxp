// Ported from: linuxdoom-1.10/r_bsp.c (R_Subsector) + r_plane.c.
// Floors/ceilings built per subsector: clip a map-bound quad by each leaf's BSP
// partition half-planes (root → leaf) to recover its convex polygon.

import * as THREE from '../vendor/three.module.js';
import { subsectors, numsubsectors, nodes, numnodes, vertexes, segs } from './p_setup.js';
import { NF_SUBSECTOR } from './doomdata.js';
import { R_GetFlatTexture, R_RegisterFlatMesh } from './r_data.js';
import { R_MakeDoomMaterial } from './r_shader.js';
import { skyflatnum } from './doomstat.js';

// sector → [{bucket, kind, startVertex, vertexCount}] for the by-sector updaters.
const _sectorContribs = new Map();

// Sutherland–Hodgman clip by a node's partition half-plane (f<0 = side 0, right).
function clipPolyByHalfplane(poly, nx, ny, dx, dy, keepNeg) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const cur = poly[i], nxt = poly[(i + 1) % n];
    const fc = dx * (cur.y - ny) - dy * (cur.x - nx);
    const fn = dx * (nxt.y - ny) - dy * (nxt.x - nx);
    const curIn = keepNeg ? fc <= 0 : fc >= 0;
    const nxtIn = keepNeg ? fn <= 0 : fn >= 0;
    if (curIn) out.push(cur);
    if (curIn !== nxtIn) {
      const t = fc / (fc - fn);
      out.push({ x: cur.x + t * (nxt.x - cur.x), y: cur.y + t * (nxt.y - cur.y) });
    }
  }
  return out;
}

// Drop near-duplicate vertices (avoids zero-area triangles).
function cleanPoly(poly) {
  const eps = 1 / 256;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = out.length > 0 ? out[out.length - 1] : null;
    if (q !== null && Math.abs(p.x - q.x) < eps && Math.abs(p.y - q.y) < eps) continue;
    out.push(p);
  }
  if (out.length >= 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps) out.pop();
  }
  return out;
}

// Shoelace signed area; positive == CCW (fans to a +Y floor normal).
function polySignedArea(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return s * 0.5;
}

// No-node map: the lone leaf's segs already close the polygon.
function polyFromSegs(sub) {
  const pts = [];
  for (let i = 0; i < sub.numlines; i++) {
    const sg = segs[sub.firstline + i];
    pts.push({ x: sg.v1.x / 65536, y: sg.v1.y / 65536 });
  }
  return cleanPoly(pts);
}

// Fan-triangulate a convex poly into its per-flat bucket; record it per sector.
function pushConvexPoly(buckets, flatnum, sector, poly, height, reverse, kind) {
  if (flatnum < 0) return;
  let b = buckets.get(flatnum);
  if (b === undefined) {
    b = { positions: [], uvs: [], colors: [], indices: [] };
    buckets.set(flatnum, b);
  }
  const startVertex = b.positions.length / 3;
  const l = sector.lightlevel / 255;
  for (let i = 0; i < poly.length; i++) {
    const x = poly[i].x, y = poly[i].y;
    b.positions.push(x, height, -y);
    b.uvs.push(x / 64, y / 64);
    b.colors.push(l, l, l);
  }
  for (let i = 1; i < poly.length - 1; i++) {
    if (reverse) b.indices.push(startVertex, startVertex + i + 1, startVertex + i);
    else         b.indices.push(startVertex, startVertex + i, startVertex + i + 1);
  }
  let arr = _sectorContribs.get(sector);
  if (arr === undefined) { arr = []; _sectorContribs.set(sector, arr); }
  arr.push({ bucket: b, kind, startVertex, vertexCount: poly.length });
}

export function R_BuildPlanes(scene) {
  _sectorContribs.clear();
  const floorBuckets   = new Map();
  const ceilingBuckets = new Map();

  // BSP is child-down only; record each node/leaf's parent + slot to walk up.
  const parent       = new Int32Array(numnodes).fill(-1);
  const parentSide   = new Int8Array(numnodes);
  const ssParent     = new Int32Array(numsubsectors).fill(-1);
  const ssParentSide = new Int8Array(numsubsectors);
  for (let ni = 0; ni < numnodes; ni++) {
    const node = nodes[ni];
    for (let s = 0; s < 2; s++) {
      const c = node.children[s];
      if ((c & NF_SUBSECTOR) !== 0) {
        ssParent[c & ~NF_SUBSECTOR] = ni;
        ssParentSide[c & ~NF_SUBSECTOR] = s;
      } else {
        parent[c] = ni;
        parentSide[c] = s;
      }
    }
  }

  // Map-bound quad seed (CCW); outer walls are partition lines, so it never leaks.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < vertexes.length; i++) {
    const vx = vertexes[i].x / 65536, vy = vertexes[i].y / 65536;
    if (vx < minX) minX = vx;
    if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy;
    if (vy > maxY) maxY = vy;
  }
  const pad = 8;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;

  for (let ssi = 0; ssi < numsubsectors; ssi++) {
    const sub = subsectors[ssi];
    const sector = sub.sector;
    if (sector === null || sector === undefined) continue;

    let poly;
    if (numnodes === 0) {
      poly = polyFromSegs(sub);
    } else {
      poly = [
        { x: minX, y: minY }, { x: maxX, y: minY },
        { x: maxX, y: maxY }, { x: minX, y: maxY },
      ];
      let n = ssParent[ssi], side = ssParentSide[ssi];
      while (n !== -1) {
        const node = nodes[n];
        poly = clipPolyByHalfplane(poly, node.x / 65536, node.y / 65536,
          node.dx / 65536, node.dy / 65536, side === 0);
        if (poly.length < 3) break;
        side = parentSide[n];
        n = parent[n];
      }
      poly = cleanPoly(poly);
    }
    if (poly === null || poly.length < 3) continue;
    // Keep CCW so the floor fan faces +Y.
    if (polySignedArea(poly) < 0) poly.reverse();

    if (sector.floorpic !== skyflatnum) {
      pushConvexPoly(floorBuckets, sector.floorpic, sector, poly,
        sector.floorheight / 65536, false, 'floor');
    }
    if (sector.ceilingpic !== skyflatnum) {
      pushConvexPoly(ceilingBuckets, sector.ceilingpic, sector, poly,
        sector.ceilingheight / 65536, true, 'ceiling');
    }
  }

  function makeMesh(buckets, name) {
    const group = new THREE.Group();
    group.name = name;
    for (const [flatnum, b] of buckets) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
      g.setAttribute('uv',       new THREE.Float32BufferAttribute(b.uvs, 2));
      g.setAttribute('color',    new THREE.Float32BufferAttribute(b.colors, 3));
      g.setIndex(b.indices);
      g.computeVertexNormals();
      const map = R_GetFlatTexture(flatnum);
      const mat = R_MakeDoomMaterial(map, { side: THREE.FrontSide });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      // Wire each bucket back to its mesh so updates can hit the right geometry.
      b.mesh = mesh;
      R_RegisterFlatMesh(flatnum, mesh);
      group.add(mesh);
    }
    scene.add(group);
    return group;
  }
  return { floors: makeMesh(floorBuckets, 'floors'), ceilings: makeMesh(ceilingBuckets, 'ceilings') };
}

// R_UpdateSectorPlanes — call after sector.floorheight or .ceilingheight changes.
// Updates the Y (height) component of every vertex contributed by this sector,
// and the walls that touch this sector (door/lift/floor animation).
import { R_UpdateSectorWalls, R_UpdateSectorWallLight } from './r_segs.js';
export function R_UpdateSectorPlanes(sector) {
  const arr = _sectorContribs.get(sector);
  if (arr !== undefined) {
    for (const c of arr) {
      const h = (c.kind === 'floor' ? sector.floorheight : sector.ceilingheight) / 65536;
      const pos = c.bucket.mesh.geometry.attributes.position;
      for (let i = 0; i < c.vertexCount; i++) {
        pos.setY(c.startVertex + i, h);
      }
      pos.needsUpdate = true;
    }
  }
  R_UpdateSectorWalls(sector);
}

// R_UpdateSectorLight — call after sector.lightlevel changes. Updates the
// per-vertex color on this sector's floor + ceiling contributions, plus the
// walls whose light is driven by this sector.
export function R_UpdateSectorLight(sector) {
  const arr = _sectorContribs.get(sector);
  if (arr !== undefined) {
    const l = sector.lightlevel / 255;
    for (const c of arr) {
      const col = c.bucket.mesh.geometry.attributes.color;
      for (let i = 0; i < c.vertexCount; i++) {
        col.setXYZ(c.startVertex + i, l, l, l);
      }
      col.needsUpdate = true;
    }
  }
  R_UpdateSectorWallLight(sector);
}
