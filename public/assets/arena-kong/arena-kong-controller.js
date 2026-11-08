import * as THREE from 'three';

/**
 * Kong Gorak — controlador de IA e ações procedurais para Three.js.
 *
 * IMPORTANTE:
 * O GLB possui clipes reais idle, standing_relax e walk.
 * As ações de ataque abaixo são poses procedurais sincronizadas com física;
 * elas não substituem clipes artísticos gravados de chute, soco ou rugido.
 *
 * Ordem recomendada no loop:
 *   mixer.update(dt);
 *   controller.update(dt);
 */
export class KongGorakController {
  constructor({ model, mixer = null, clips = {}, scene, ball, cars = [], physics = {}, goal = null, camera = null, effects = {} }) {
    this.model = model;
    this.mixer = mixer;
    this.clips = clips;
    this.scene = scene;
    this.ball = ball;
    this.cars = cars;
    this.physics = physics;
    this.goal = goal;
    this.camera = camera;
    this.effects = effects;

    this.state = 'PATROL';
    this.stateTime = 0;
    this.actionCooldown = 0;
    this.walkDirection = 1;
    this.speed = 2.1;
    this.impactRadius = 7.5;
    this._hit = false;
    this._heldBall = null;
    this._locomotionAction = null;
    this._previousAction = null;

    this._bones = this._findBones(model);
    this._rest = new Map();
    this._bones.all.forEach((bone) => {
      bone.updateMatrixWorld(true);
      this._rest.set(bone, {
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone()
      });
    });

    this._setLocomotion('idle');
  }

  _findBones(root) {
    const all = [];
    root.traverse((object) => { if (object.isBone) all.push(object); });
    const find = (...terms) => all.find((bone) => {
      const name = bone.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return terms.some((term) => name.includes(term));
    });
    return {
      all,
      hips: find('hips', 'pelvis', 'root'),
      spine: find('spine', 'chest', 'torso'),
      head: find('head'),
      jaw: find('jaw', 'mouth'),
      leftUpperArm: find('leftupperarm', 'lupperarm', 'upperarml', 'arml'),
      rightUpperArm: find('rightupperarm', 'rupperarm', 'upperarmr', 'armr'),
      leftForearm: find('leftforearm', 'lforearm', 'forearml'),
      rightForearm: find('rightforearm', 'rforearm', 'forearmr'),
      leftHand: find('lefthand', 'lhand', 'handl'),
      rightHand: find('righthand', 'rhand', 'handr'),
      leftThigh: find('leftthigh', 'lthigh', 'thighl'),
      rightThigh: find('rightthigh', 'rthigh', 'thighr'),
      leftShin: find('leftshin', 'lshin', 'calfl'),
      rightShin: find('rightshin', 'rshin', 'calfr'),
      leftFoot: find('leftfoot', 'lfoot', 'footl'),
      rightFoot: find('rightfoot', 'rfoot', 'footr')
    };
  }

  update(dt) {
    if (!this.model) return;
    this.stateTime += dt;
    this.actionCooldown = Math.max(0, this.actionCooldown - dt);

    if (this._heldBall) this._keepBallInHand();

    switch (this.state) {
      case 'PATROL': this._patrol(dt); break;
      case 'CHASE_BALL': this._chaseBall(dt); break;
      case 'RAGE': this._rage(); break;
      case 'KICK_BALL': this._kickBall(); break;
      case 'PUNCH_CAR': this._punchCar(); break;
      case 'GRAB_BALL': this._grabBall(); break;
      case 'THROW_BALL': this._throwBall(); break;
      case 'BUTT_SLAM': this._buttSlam(); break;
      case 'RECOVER': this._recover(); break;
      default: this._start('PATROL');
    }

    if (this.state === 'PATROL' || this.state === 'CHASE_BALL') this._chooseAction();
  }

  _setLocomotion(name) {
    if (!this.mixer || !this.clips?.[name]) return;
    const next = this.mixer.clipAction(this.clips[name]);
    next.enabled = true;
    next.setLoop(THREE.LoopRepeat, Infinity);
    if (this._locomotionAction && this._locomotionAction !== next) {
      this._locomotionAction.fadeOut(0.16);
    }
    next.reset().fadeIn(0.16).play();
    this._locomotionAction = next;
  }

  _pauseLocomotion() {
    if (this._locomotionAction) {
      this._locomotionAction.fadeOut(0.08);
      this._locomotionAction.paused = true;
      this._previousAction = this._locomotionAction;
    }
    this._restoreRestPose();
  }

  _resumeLocomotion(name = 'idle') {
    this._restoreRestPose();
    if (this._previousAction) {
      this._previousAction.paused = false;
      this._previousAction.reset().fadeIn(0.16).play();
      this._locomotionAction = this._previousAction;
      this._previousAction = null;
    } else {
      this._setLocomotion(name);
    }
  }

  _restoreRestPose() {
    for (const bone of this._bones.all) {
      const rest = this._rest.get(bone);
      if (!rest) continue;
      bone.position.copy(rest.position);
      bone.quaternion.copy(rest.quaternion);
      bone.scale.copy(rest.scale);
    }
  }

  _chooseAction() {
    if (this.actionCooldown > 0 || this.stateTime < 0.8) return;
    const ballDistance = this.ball ? this.model.position.distanceTo(this.ball.position) : Infinity;
    const car = this._nearestCar();
    const carDistance = car ? this.model.position.distanceTo(car.position) : Infinity;
    if (ballDistance < 3.8 && Math.random() < 0.18) return this._start('KICK_BALL');
    if (ballDistance < 2.4 && Math.random() < 0.08) return this._start('GRAB_BALL');
    if (carDistance < 4.0 && Math.random() < 0.14) return this._start('PUNCH_CAR');
    if (Math.random() < 0.025) return this._start('RAGE');
  }

  _start(next) {
    this.state = next;
    this.stateTime = 0;
    this._hit = false;
    if (!['PATROL', 'CHASE_BALL'].includes(next)) this._pauseLocomotion();
    this.effects.onState?.(next);
  }

  _finish(next = 'PATROL') {
    this._hit = false;
    this.state = next;
    this.stateTime = 0;
    this.actionCooldown = 1.2;
    this._resumeLocomotion(next === 'PATROL' ? 'walk' : 'idle');
  }

  _patrol(dt) {
    this._setLocomotion('walk');
    this.model.position.x += this.walkDirection * this.speed * dt;
    if (Math.abs(this.model.position.x) > 18) {
      this.walkDirection *= -1;
      this.model.rotation.y = this.walkDirection > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    if (this.ball && this.model.position.distanceTo(this.ball.position) < 9) this._start('CHASE_BALL');
  }

  _chaseBall(dt) {
    this._setLocomotion('walk');
    if (!this.ball) return this._finish();
    const direction = this.ball.position.clone().sub(this.model.position);
    direction.y = 0;
    if (direction.length() > 2.6) {
      direction.normalize();
      this.model.position.addScaledVector(direction, this.speed * 1.35 * dt);
      this.model.lookAt(this.ball.position.x, this.model.position.y, this.ball.position.z);
    } else {
      this._finish();
    }
  }

  _rage() {
    const t = Math.min(1, this.stateTime / 0.42);
    const hold = Math.min(1, Math.max(0, (1.45 - this.stateTime) / 0.35));
    const k = Math.max(t, hold);
    this._poseRoar(k);
    this.effects.rage?.(k);
    if (this.stateTime > 1.5) this._finish();
  }

  _kickBall() {
    const t = Math.min(1, this.stateTime / 0.9);
    this._poseKick(t);
    if (this.stateTime > 0.48 && !this._hit) {
      this._hit = true;
      this._ballImpulse(18);
      this.effects.kick?.(this.ball?.position);
    }
    if (this.stateTime > 1.0) this._finish();
  }

  _punchCar() {
    const t = Math.min(1, this.stateTime / 0.85);
    this._posePunch(t);
    if (this.stateTime > 0.42 && !this._hit) {
      this._hit = true;
      this._carImpulse(15);
      this.effects.punch?.(this._nearestCar()?.position);
    }
    if (this.stateTime > 0.98) this._finish();
  }

  _grabBall() {
    const t = Math.min(1, this.stateTime / 0.8);
    this._poseGrab(t);
    if (this.stateTime > 0.42 && !this._hit) {
      this._hit = true;
      this._attachBallToHand();
      this.effects.grab?.(this.ball?.position);
    }
    if (this.stateTime > 1.05) this._start('THROW_BALL');
  }

  _throwBall() {
    const t = Math.min(1, this.stateTime / 0.85);
    this._poseThrow(t);
    if (this.stateTime > 0.34 && !this._hit) {
      this._hit = true;
      this._releaseBallWithArc();
      this.effects.throw?.(this.ball?.position);
    }
    if (this.stateTime > 0.95) this._finish();
  }

  _buttSlam() {
    const t = Math.min(1, this.stateTime / 1.25);
    this._poseSlam(t);
    if (this.stateTime > 0.78 && !this._hit) {
      this._hit = true;
      this._radialImpulse();
      this.effects.slam?.(this.model.position);
    }
    if (this.stateTime > 1.38) this._finish();
  }

  _recover() {
    if (this.stateTime > 0.5) this._finish();
  }

  _poseRoar(k) {
    this._setEuler(this._bones.spine, -0.14 * k, 0, 0);
    this._setEuler(this._bones.leftUpperArm, -0.55 * k, 0, -0.22 * k);
    this._setEuler(this._bones.rightUpperArm, -0.55 * k, 0, 0.22 * k);
    this._setEuler(this._bones.leftForearm, -0.18 * k, 0, 0);
    this._setEuler(this._bones.rightForearm, -0.18 * k, 0, 0);
    if (this._bones.jaw) this._setEuler(this._bones.jaw, 0.42 * k, 0, 0);
  }

  _poseKick(t) {
    const k = Math.sin(Math.PI * t);
    this._setEuler(this._bones.spine, 0.16 * k, 0, 0);
    this._setEuler(this._bones.leftThigh, 0.18 * k, 0, 0);
    this._setEuler(this._bones.rightThigh, -1.0 * k, 0, 0);
    this._setEuler(this._bones.rightShin, 1.38 * k, 0, 0);
    this._setEuler(this._bones.rightFoot, -0.25 * k, 0, 0);
  }

  _posePunch(t) {
    const k = Math.sin(Math.PI * t);
    this._setEuler(this._bones.spine, 0, -0.25 * k, 0);
    this._setEuler(this._bones.rightUpperArm, -0.95 * k, -0.18 * k, -0.35 * k);
    this._setEuler(this._bones.rightForearm, -0.95 * k, 0, 0);
    this._setEuler(this._bones.leftUpperArm, 0.28 * k, 0, 0.18 * k);
  }

  _poseGrab(t) {
    const k = Math.sin(Math.PI * t);
    this._setEuler(this._bones.spine, 0.18 * k, 0, 0);
    this._setEuler(this._bones.leftUpperArm, -0.72 * k, 0, -0.68 * k);
    this._setEuler(this._bones.rightUpperArm, -0.72 * k, 0, 0.68 * k);
    this._setEuler(this._bones.leftForearm, -0.48 * k, 0, 0);
    this._setEuler(this._bones.rightForearm, -0.48 * k, 0, 0);
  }

  _poseThrow(t) {
    const k = Math.sin(Math.PI * t);
    this._setEuler(this._bones.spine, -0.24 * k, 0, 0);
    this._setEuler(this._bones.leftUpperArm, -1.1 * k, 0, -0.45 * k);
    this._setEuler(this._bones.rightUpperArm, -1.1 * k, 0, 0.45 * k);
    this._setEuler(this._bones.leftForearm, -0.35 * k, 0, 0);
    this._setEuler(this._bones.rightForearm, -0.35 * k, 0, 0);
  }

  _poseSlam(t) {
    const k = Math.sin(Math.PI * t);
    this._setEuler(this._bones.hips, 0.34 * k, 0, 0);
    this._setEuler(this._bones.spine, 0.68 * k, 0, 0);
    this._setEuler(this._bones.leftUpperArm, 0.95 * k, 0, -0.3 * k);
    this._setEuler(this._bones.rightUpperArm, 0.95 * k, 0, 0.3 * k);
    this._setEuler(this._bones.leftThigh, -0.48 * k, 0, 0);
    this._setEuler(this._bones.rightThigh, -0.48 * k, 0, 0);
  }

  _setEuler(bone, x, y, z) {
    if (!bone) return;
    const rest = this._rest.get(bone);
    bone.quaternion.copy(rest ? rest.quaternion : new THREE.Quaternion());
    bone.rotateX(x);
    bone.rotateY(y);
    bone.rotateZ(z);
  }

  _attachBallToHand() {
    if (!this.ball || !this._bones.rightHand || this._heldBall) return;
    const hand = this._bones.rightHand;
    hand.updateWorldMatrix(true, false);
    const world = new THREE.Vector3();
    this.ball.getWorldPosition(world);
    hand.attach(this.ball);
    this.ball.position.set(0, 0.5, 0);
    this.ball.userData.kongHeld = true;
    this._heldBall = this.ball;
    this.physics.setKinematic?.(this.ball, true);
    this.physics.setSensor?.(this.ball, true);
  }

  _keepBallInHand() {
    if (!this._heldBall || !this._bones.rightHand) return;
    this._heldBall.position.set(0, 0.5, 0);
    this._heldBall.quaternion.identity();
  }

  _releaseBallWithArc() {
    if (!this._heldBall) return;
    const ball = this._heldBall;
    const worldPosition = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    ball.getWorldPosition(worldPosition);
    ball.getWorldQuaternion(worldQuaternion);
    this.scene.attach(ball);
    ball.position.copy(worldPosition);
    ball.quaternion.copy(worldQuaternion);
    ball.userData.kongHeld = false;
    this.physics.setSensor?.(ball, false);
    this.physics.setKinematic?.(ball, false);
    const direction = this.model.getWorldDirection(new THREE.Vector3());
    direction.y = 0.34;
    direction.normalize();
    this.physics.applyImpulse?.(ball, direction.multiplyScalar(28));
    this._heldBall = null;
  }

  _nearestCar() {
    return this.cars.filter(Boolean).sort((a, b) => this.model.position.distanceTo(a.position) - this.model.position.distanceTo(b.position))[0];
  }

  _ballImpulse(force) {
    if (!this.ball || this.ball.userData.kongHeld) return;
    const direction = this.ball.position.clone().sub(this.model.position).normalize();
    direction.y = 0.18;
    direction.normalize();
    this.physics.applyImpulse?.(this.ball, direction.multiplyScalar(force));
  }

  _carImpulse(force) {
    const car = this._nearestCar();
    if (!car) return;
    const direction = car.position.clone().sub(this.model.position).normalize();
    direction.y = 0.55;
    direction.normalize();
    this.physics.applyImpulse?.(car, direction.multiplyScalar(force));
    this.physics.applyAngularImpulse?.(car, new THREE.Vector3(0, force * 0.35, force * 0.2));
  }

  _radialImpulse() {
    const objects = [this.ball, ...this.cars].filter(Boolean);
    for (const object of objects) {
      const direction = object.position.clone().sub(this.model.position);
      const distance = Math.max(0.1, direction.length());
      if (distance < this.impactRadius) {
        direction.normalize().multiplyScalar(22 * (1 - distance / this.impactRadius));
        direction.y = Math.max(direction.y, 0.38);
        this.physics.applyImpulse?.(object, direction);
      }
    }
    this.camera?.shake?.(0.45, 0.25);
  }
}
