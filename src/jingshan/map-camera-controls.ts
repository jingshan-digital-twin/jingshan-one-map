import { CameraEventType, KeyboardEventModifier, type ScreenSpaceCameraController } from 'cesium'

export function configureMapCameraControls(controller: ScreenSpaceCameraController) {
  controller.zoomEventTypes = [CameraEventType.WHEEL, CameraEventType.PINCH]
  controller.tiltEventTypes = [
    CameraEventType.RIGHT_DRAG,
    CameraEventType.PINCH,
    {eventType:CameraEventType.LEFT_DRAG, modifier:KeyboardEventModifier.CTRL},
    {eventType:CameraEventType.RIGHT_DRAG, modifier:KeyboardEventModifier.CTRL},
  ]
}
