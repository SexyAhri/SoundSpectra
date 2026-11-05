import { Euler, MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { SceneView } from './view'

/** Preview and desktop derive the same camera entirely from saved region state. */
export class SceneCamera {
  private readonly orbit = new Quaternion()
  private readonly angles = new Euler(0, 0, 0, 'YXZ')
  private readonly offset = new Vector3()
  private readonly shift = new Vector3()
  private readonly right = new Vector3()
  private readonly up = new Vector3()

  apply(camera: PerspectiveCamera, position: Vector3, target: Vector3, view: SceneView) {
    this.angles.set(MathUtils.degToRad(view.pitch), MathUtils.degToRad(view.yaw), 0, 'YXZ')
    this.orbit.setFromEuler(this.angles)
    this.offset.copy(position).sub(target).applyQuaternion(this.orbit).multiplyScalar(view.distance)
    camera.position.copy(target).add(this.offset)
    camera.up.set(0, 1, 0).applyQuaternion(this.orbit)
    camera.lookAt(target); camera.rotateZ(MathUtils.degToRad(view.roll)); camera.updateMatrixWorld()
    const height = 2 * this.offset.length() * Math.tan(MathUtils.degToRad(camera.fov) / 2)
    this.right.setFromMatrixColumn(camera.matrixWorld, 0)
    this.up.setFromMatrixColumn(camera.matrixWorld, 1)
    this.shift.copy(this.right).multiplyScalar(-view.x / 100 * height * camera.aspect)
      .addScaledVector(this.up, -view.y / 100 * height)
    camera.position.add(this.shift); camera.updateMatrixWorld()
  }
}
