/* ================================================================
   boss.js — модель босса (группа из коробок).
================================================================ */
import * as THREE from 'three'
import * as CFG from '../../config.js'
import { scene } from '../scene.js'

export const boss = new THREE.Group()
boss.position.set(...CFG.BOSS.position)

const skinMat = new THREE.MeshStandardMaterial({ color: CFG.BOSS.colors.skin, roughness: 0.55 })
const darkMat = new THREE.MeshStandardMaterial({ color: CFG.BOSS.colors.dark, roughness: 0.8 })
const accentMat = new THREE.MeshStandardMaterial({
  color: CFG.BOSS.colors.accent,
  roughness: 0.4,
  metalness: 0.3,
})

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export const torso = box(2.0, 2.4, 1.4, skinMat)
torso.position.y = 3.8
boss.add(torso)

const chest = box(1.1, 0.9, 0.15, accentMat)
chest.position.set(0, 4.0, 0.75)
boss.add(chest)

export const head = box(1.25, 1.2, 1.2, skinMat)
head.position.y = 5.7
boss.add(head)

for (const zz of [0.62, -0.62]) {
  const eye = box(0.3, 0.22, 0.1, darkMat)
  eye.position.set(0.3, 5.85, zz)
  boss.add(eye)
}
const brow = box(0.36, 0.1, 0.12, darkMat)
brow.position.set(0.32, 6.05, 0.62)
brow.rotation.z = -0.35
boss.add(brow)
const brow2 = brow.clone()
brow2.position.z = -0.62
brow2.rotation.z = 0.35
boss.add(brow2)

const armL = box(0.55, 2.1, 0.55, skinMat)
armL.geometry.translate(0, -1.05, 0)
armL.position.set(0, 4.7, 1.05)
boss.add(armL)

const armR = box(0.55, 2.1, 0.55, skinMat)
armR.geometry.translate(0, -1.05, 0)
armR.position.set(0, 4.7, -1.05)
boss.add(armR)

function makeLeg() {
  const pivot = new THREE.Group()
  const upper = box(0.72, 1.4, 0.72, darkMat)
  upper.position.y = -0.7
  pivot.add(upper)
  const lower = box(0.62, 1.3, 0.62, darkMat)
  lower.position.y = -2.0
  pivot.add(lower)
  const foot = box(0.85, 0.4, 0.95, accentMat)
  foot.position.set(0.18, -2.75, 0)
  pivot.add(foot)
  return pivot
}

export const legBack = makeLeg()
legBack.position.set(0, 2.6, -0.5)
boss.add(legBack)

export const legKick = makeLeg()
legKick.position.set(0, 2.6, 0.5)
boss.add(legKick)

scene.add(boss)
