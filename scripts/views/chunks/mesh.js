/* ================================================================
   mesh.js — создание мешей чанка.
   Два пути:
     • sync:  makeChunkMesh + spawnChunkProps (fallback без воркеров)
     • async: buildMeshFromWorker + spawnPropsFromWorker (из воркер-данных)
================================================================ */
import * as THREE from 'three'
import * as CFG from '../../config.js'
import { scene, groundMat, SUN_DIR } from '../scene.js'
import { TEMPLATES } from '../../world/props.js'
import { terrainHeight, heightToTerrainColor, terrainBrightnessNoise } from '../../world/world.js'
import { propMat } from './props.js'
import { CHUNK_SIZE, CHUNK_SEG } from './constants.js'


const GROUND_TILE_LOCAL = CFG.GROUND_TEX.tile
const _dummyObj = new THREE.Object3D()

/* ================================================================
   SYNC PATH — makeChunkMesh
================================================================ */
export function makeChunkMesh(cx, cz, items) {
  const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEG, CHUNK_SEG)
  geo.rotateX(-Math.PI / 2)

  const cxw = cx * CHUNK_SIZE + CHUNK_SIZE / 2
  const czw = cz * CHUNK_SIZE + CHUNK_SIZE / 2
  const baseX = cx * CHUNK_SIZE
  const baseZ = cz * CHUNK_SIZE

  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const nrm = geo.attributes.normal

  const colArr = new Float32Array(pos.count * 3)
  const col = new THREE.Color()
  const shadowB = new Float32Array(pos.count).fill(1)

  const step = CHUNK_SIZE / CHUNK_SEG
  const VPR = CHUNK_SEG + 1
  const heightGrid = new Float32Array(VPR * VPR)

  for (let i = 0; i < pos.count; i++) {
    const wx = cxw + pos.getX(i)
    const wz = czw + pos.getZ(i)
    const h = terrainHeight(wx, wz)

    pos.setY(i, h)

    const gix = Math.round((pos.getX(i) + CHUNK_SIZE / 2) / step)
    const giz = Math.round((pos.getZ(i) + CHUNK_SIZE / 2) / step)
    heightGrid[giz * VPR + gix] = h

    uv.setXY(i, wx / GROUND_TILE_LOCAL, wz / GROUND_TILE_LOCAL)

    heightToTerrainColor(h, col)
    const b = terrainBrightnessNoise(wx, wz)
    colArr[i * 3] = col.r * b
    colArr[i * 3 + 1] = col.g * b
    colArr[i * 3 + 2] = col.b * b
  }

  for (let i = 0; i < pos.count; i++) {
    const gix = Math.round((pos.getX(i) + CHUNK_SIZE / 2) / step)
    const giz = Math.round((pos.getZ(i) + CHUNK_SIZE / 2) / step)
    const h = heightGrid[giz * VPR + gix]

    const hx =
      gix < CHUNK_SEG
        ? heightGrid[giz * VPR + gix + 1]
        : terrainHeight(cxw + pos.getX(i) + step, czw + pos.getZ(i))
    const hz =
      giz < CHUNK_SEG
        ? heightGrid[(giz + 1) * VPR + gix]
        : terrainHeight(cxw + pos.getX(i), czw + pos.getZ(i) + step)

    const nx = -(hx - h) / step
    const nz = -(hz - h) / step
    const len = Math.hypot(nx, 1, nz)
    nrm.setXYZ(i, nx / len, 1 / len, nz / len)
  }

  /* ---------- Запекание теней ---------- */
  const shLenXZ = Math.hypot(SUN_DIR.x, SUN_DIR.z) || 1
  const shDirX = -SUN_DIR.x / shLenXZ
  const shDirZ = -SUN_DIR.z / shLenXZ

  const shStrength = CFG.PROPS.shadow.strength
  const shScale = CFG.PROPS.shadow.scale
  const shSoft = CFG.PROPS.shadow.softness
  const shDist = CFG.PROPS.shadow.offset

  const treeRadius = (kind) => {
    if (kind === 'pine') return 1.6
    if (kind === 'oak') return 1.8
    if (kind === 'bush') return 0.8
    return 0
  }

  for (let k = 0; k < items.length; k++) {
    const it = items[k]
    const baseR = treeRadius(it.kind)
    if (baseR <= 0) continue

    const R = baseR * it.scale * shScale
    if (R <= 0) continue

    const tOffset = shDist * (0.6 + 0.4 * it.scale)
    const tx = it.x + shDirX * tOffset
    const tz = it.z + shDirZ * tOffset

    const lx = tx - baseX
    const lz = tz - baseZ

    const ix0 = Math.max(0, Math.floor((lx - R) / step))
    const ix1 = Math.min(CHUNK_SEG, Math.ceil((lx + R) / step))
    const iz0 = Math.max(0, Math.floor((lz - R) / step))
    const iz1 = Math.min(CHUNK_SEG, Math.ceil((lz + R) / step))

    const R2 = R * R

    for (let iz = iz0; iz <= iz1; iz++) {
      const vz = iz * step
      const dz = vz - lz
      const dz2 = dz * dz
      const rowBase = iz * VPR

      for (let ix = ix0; ix <= ix1; ix++) {
        const vx = ix * step
        const dx = vx - lx
        const d2 = dx * dx + dz2
        if (d2 > R2) continue

        const t = Math.sqrt(d2) / R
        const w = 1 - Math.pow(t, shSoft)
        const shade = 1 - w * shStrength

        const idx = rowBase + ix
        if (shade < shadowB[idx]) shadowB[idx] = shade
      }
    }
  }

  for (let i = 0; i < pos.count; i++) {
    const s = shadowB[i]
    if (s < 1) {
      colArr[i * 3] *= s
      colArr[i * 3 + 1] *= s
      colArr[i * 3 + 2] *= s
    }
  }

  pos.needsUpdate = true
  uv.needsUpdate = true
  nrm.needsUpdate = true
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3))

  const mesh = new THREE.Mesh(geo, groundMat)
  mesh.position.set(cxw, 0, czw)
  mesh.receiveShadow = true

  /* ---------- Билинейный сэмплер высоты ---------- */
  const stepRecip = 1 / step
  mesh.userData.terrainSampler = (x, z) => {
    const gx = (x - baseX) * stepRecip
    const gz = (z - baseZ) * stepRecip

    let ix = Math.floor(gx),
      iz = Math.floor(gz)
    let fx = gx - ix,
      fz = gz - iz

    if (ix < 0) {
      ix = 0
      fx = 0
    } else if (ix > VPR - 2) {
      ix = VPR - 2
      fx = 1
    }
    if (iz < 0) {
      iz = 0
      fz = 0
    } else if (iz > VPR - 2) {
      iz = VPR - 2
      fz = 1
    }

    const i00 = iz * VPR + ix
    const i10 = i00 + 1
    const i01 = i00 + VPR
    const i11 = i01 + 1

    return (
      heightGrid[i00] * (1 - fx) * (1 - fz) +
      heightGrid[i10] * fx * (1 - fz) +
      heightGrid[i01] * (1 - fx) * fz +
      heightGrid[i11] * fx * fz
    )
  }

  return mesh
}

/* ================================================================
   SYNC PATH — spawnChunkProps
================================================================ */
export function spawnChunkProps(cx, cz, items, sampleH) {
  const groups = { pine: [], oak: [], bush: [], rock: [] }
  for (const it of items) {
    groups[it.kind].push({
      x: it.x,
      y: sampleH(it.x, it.z),
      z: it.z,
      scale: it.scale,
      rotY: it.rotY,
    })
  }

  const meshes = []
  for (const kind of ['pine', 'oak', 'bush', 'rock']) {
    const list = groups[kind]
    if (list.length === 0) continue

    const inst = new THREE.InstancedMesh(TEMPLATES[kind], propMat, list.length)
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    inst.castShadow = false
    inst.receiveShadow = false
    inst.frustumCulled = true

    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      _dummyObj.position.set(it.x, it.y, it.z)
      _dummyObj.rotation.set(0, it.rotY, 0)
      _dummyObj.scale.setScalar(it.scale)
      _dummyObj.updateMatrix()
      inst.setMatrixAt(i, _dummyObj.matrix)
    }
    inst.instanceMatrix.needsUpdate = true
    scene.add(inst)
    meshes.push(inst)
  }

  return meshes
}

/* ================================================================
   ASYNC PATH — из данных воркера
================================================================ */
export function buildMeshFromWorker(cx, cz, data) {
  const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEG, CHUNK_SEG)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, data.heights[i])
  }
  pos.needsUpdate = true

  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))

  const cxw = cx * CHUNK_SIZE + CHUNK_SIZE / 2
  const czw = cz * CHUNK_SIZE + CHUNK_SIZE / 2
  const mesh = new THREE.Mesh(geo, groundMat)
  mesh.position.set(cxw, 0, czw)
  mesh.receiveShadow = true
  return mesh
}

export function spawnPropsFromWorker(propMatrices) {
  const meshes = []
  for (const kind of ['pine', 'oak', 'bush', 'rock']) {
    const data = propMatrices[kind]
    if (data.length === 0) continue
    const count = data.length / 16

    const inst = new THREE.InstancedMesh(TEMPLATES[kind], propMat, count)
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    inst.castShadow = false
    inst.receiveShadow = false
    inst.frustumCulled = true

    inst.instanceMatrix.array.set(data)
    inst.instanceMatrix.needsUpdate = true

    scene.add(inst)
    meshes.push(inst)
  }
  return meshes
}
