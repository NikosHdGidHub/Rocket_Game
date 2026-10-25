/* ================================================================
   rocket.js — модель ракеты: корпус, нос, плавники, пламя, свет сопла.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../../config.js'
import { scene } from '../scene.js'

export const rocket = new THREE.Group()

const bodyMat = new THREE.MeshStandardMaterial({
  color: CFG.ROCKET.colors.body,
  metalness: 0.55,
  roughness: 0.3,
})
const redMat = new THREE.MeshStandardMaterial({
  color: CFG.ROCKET.colors.red,
  metalness: 0.3,
  roughness: 0.45,
})
const glassMat = new THREE.MeshStandardMaterial({
  color: CFG.ROCKET.colors.glass,
  metalness: 0.9,
  roughness: 0.15,
})
const rocketDarkMat = new THREE.MeshStandardMaterial({
  color: CFG.BOSS.colors.dark,
  roughness: 0.8,
})

const rBody = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 2.2, 16), bodyMat)
rBody.rotation.z = Math.PI / 2
rBody.castShadow = true
rocket.add(rBody)

const rNose = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.0, 16), redMat)
rNose.rotation.z = -Math.PI / 2
rNose.position.x = 1.6
rNose.castShadow = true
rocket.add(rNose)

const port = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 12), glassMat)
port.rotation.x = Math.PI / 2
port.position.set(0.5, 0.3, 0.33)
rocket.add(port)

const finShape = new THREE.Shape()
finShape.moveTo(0, 0)
finShape.lineTo(-1.0, 0)
finShape.lineTo(-1.0, 0.55)
finShape.closePath()
const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.07, bevelEnabled: false })
finGeo.translate(0, 0, -0.035)

for (const sgn of [1, -1]) {
  const fin = new THREE.Mesh(finGeo, redMat)
  fin.position.set(-0.35, 0.34 * sgn, 0)
  fin.scale.y = sgn
  fin.castShadow = true
  rocket.add(fin)
}

const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.5, 0.5, 14), rocketDarkMat)
nozzle.rotation.z = Math.PI / 2
nozzle.position.x = -1.25
rocket.add(nozzle)

export const flameMat = new THREE.MeshBasicMaterial({
  color: CFG.ROCKET.flame.outer,
  transparent: true,
  opacity: 0.95,
})
export const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.4, 12), flameMat)
flame.name = 'rocketFlame'
flame.rotation.z = Math.PI / 2
flame.position.x = -2.1
flame.castShadow = false
rocket.add(flame)

export const flameInner = new THREE.Mesh(
  new THREE.ConeGeometry(0.2, 0.9, 10),
  new THREE.MeshBasicMaterial({ color: CFG.ROCKET.flame.inner })
)
flameInner.name = 'rocketFlameInner'
flameInner.rotation.z = Math.PI / 2
flameInner.position.x = -1.85
flameInner.castShadow = false
rocket.add(flameInner)

export const exhaustLight = new THREE.PointLight(
  CFG.ROCKET.exhaustLight,
  0,
  CFG.ROCKET.exhaustLightRange,
  CFG.ROCKET.exhaustLightDecay
)
exhaustLight.position.set(-2.0, 0, 0)
rocket.add(exhaustLight)

scene.add(rocket)
