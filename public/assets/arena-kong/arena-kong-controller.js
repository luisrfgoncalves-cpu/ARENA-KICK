import * as THREE from 'three';

/**
 * Kong Gorak — controlador de IA e ações procedurais para Three.js (Fluido & Reativo).
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
    this.speed = 20.0;
    this.impactRadius = 38.0;
    this._hit = false;
    this._heldBall = null;
    this._locomotionAction = null;
    this._currentClipName = '';

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

    this._setLocomotion('walk');
  }

  _findBones(root) {
    const all = [];
    root.traverse((object) => { if (object.isBone) all.push(object); });

    const findExact = (...terms) => {
      for (const t of terms) {
        const found = all.find((b) => b.name.toLowerCase() === t.toLowerCase());
        if (found) return found;
      }
      for (const t of terms) {
        const cleanT = t.toLowerCase().replace(/[^a-z0-9]/g, '');
        const found = all.find((b) => {
          const cleanB = b.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          return cleanB.includes(cleanT) && !cleanB.includes('twist');
        });
        if (found) return found;
      }
      return undefined;
    };

    return {
      all,
      hips: findExact('Pelvis', 'Hip', 'Waist', 'Root'),
      spine: findExact('Spine02', 'Spine01', 'Spine'),
      head: findExact('Head'),
      jaw: findExact('Jaw', 'Head'),
      leftUpperArm: findExact('L_Upperarm', 'LeftUpperArm'),
      rightUpperArm: findExact('R_Upperarm', 'RightUpperArm'),
      leftForearm: findExact('L_Forearm', 'LeftForearm'),
      rightForearm: findExact('R_Forearm', 'RightForearm'),
      leftHand: findExact('L_Hand', 'LeftHand'),
      rightHand: findExact('R_Hand', 'RightHand'),
      leftThigh: findExact('L_Thigh', 'LeftThigh'),
      rightThigh: findExact('R_Thigh', 'RightThigh'),
      leftShin: findExact('L_Calf', 'LeftCalf', 'LeftShin'),
      rightShin: findExact('R_Calf', 'RightCalf', 'RightShin'),
      leftFoot: findExact('L_Foot', 'LeftFoot'),
      rightFoot: findExact('R_Foot', 'RightFoot')
    };
  }

  getBallPosition() {
    if (!this.ball) return null;
    if (this.ball.pos && typeof this.ball.pos.x === 'number') return this.ball.pos;
    if (this.ball.position && typeof this.ball.position.x === 'number') return this.ball.position;
    if (this.ball.mesh && this.ball.mesh.position) return this.ball.mesh.position;
    return null;
  }

  getCarPosition(car) {
    if (!car) return null;
    if (car.pos && typeof car.pos.x === 'number') return car.pos;
    if (car.position && typeof car.position.x === 'number') return car.position;
    if (car.group && car.group.position) return car.group.position;
    return null;
  }

  _lookAtTarget(target) {
    if (!this.model) return;
    const direction = target.clone().sub(this.model.position);
    direction.y = 0;
    if (direction.lengthSq() > 0.001) {
      this.model.lookAt(target.x, this.model.position.y, target.z);
    }
  }

  update(dt) {
    if (!this.model) return;
    this.stateTime += dt;
    this.actionCooldown = Math.max(0, this.actionCooldown - dt);

    if (this.mixer) {
      this.mixer.update(dt);
    }

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
    if (this._currentClipName === name && this._locomotionAction && !this._locomotionAction.paused) {
      return;
    }

    const nextAction = this.mixer.clipAction(this.clips[name]);
    nextAction.enabled = true;
    nextAction.setLoop(THREE.LoopRepeat, Infinity);

    if (this._currentClipName === name && this._locomotionAction && this._locomotionAction.paused) {
      this._locomotionAction.paused = false;
      return;
    }

    if (this._locomotionAction && this._locomotionAction !== nextAction) {
      nextAction.reset();
      nextAction.play();
      this._locomotionAction.crossFadeTo(nextAction, 0.25, true);
    } else {
      nextAction.reset().play();
    }

    this._locomotionAction = nextAction;
    this._currentClipName = name;
  }

  _pauseLocomotion() {
    if (this._locomotionAction) {
      this._locomotionAction.fadeOut(0.08);
      this._locomotionAction.paused = true;
    }
    this._restoreRestPose();
  }

  _resumeLocomotion(name = 'walk') {
    this._restoreRestPose();
    if (this._locomotionAction) {
      this._locomotionAction.paused = false;
      this._locomotionAction.fadeIn(0.18).play();
    }
    this._setLocomotion(name);
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
    if (this.actionCooldown > 0 || this.stateTime < 0.6 || !this.model) return;
    const ballPos = this.getBallPosition();
    const kongPos = this.model.position;
    const ballDistance = ballPos ? kongPos.distanceTo(ballPos) : Infinity;

    const cars = (typeof this.cars === 'function' ? this.cars() : this.cars).filter(Boolean);
    let nearestCar = null;
    let minCarDist = Infinity;
    let carsNearCount = 0;

    for (const car of cars) {
      const cPos = this.getCarPosition(car);
      if (!cPos) continue;
      const d = kongPos.distanceTo(cPos);
      if (d < 22.0) carsNearCount++;
      if (d < minCarDist) {
        minCarDist = d;
        nearestCar = car;
      }
    }

    if ((carsNearCount >= 2 || (carsNearCount >= 1 && ballDistance < 20.0)) && Math.random() < 0.35) {
      return this._start('BUTT_SLAM');
    }

    if (ballPos && ballDistance < 18.0) {
      this._lookAtTarget(ballPos);
      if (ballDistance < 13.0 && Math.random() < 0.45) return this._start('GRAB_BALL');
      return this._start('KICK_BALL');
    }

    if (nearestCar && minCarDist < 20.0) {
      const cPos = this.getCarPosition(nearestCar);
      if (cPos) this._lookAtTarget(cPos);
      return this._start('PUNCH_CAR');
    }

    if (ballPos && this.state !== 'CHASE_BALL') {
      return this._start('CHASE_BALL');
    }
  }

  _start(next) {
    this.state = next;
    this.stateTime = 0;
    this._hit = false;
    if (!['PATROL', 'CHASE_BALL'].includes(next)) this._pauseLocomotion();
    this.effects.onState?.(next);
  }

  _finish(next = 'CHASE_BALL') {
    this._hit = false;
    this.state = next;
    this.stateTime = 0;
    this.actionCooldown = 0.8;
    this._restoreRestPose();
    this._resumeLocomotion(next === 'CHASE_BALL' ? 'walk' : 'idle');
  }

  _patrol(dt) {
    if (!this.model) return;
    const ballPos = this.getBallPosition();
    if (ballPos) {
      this._start('CHASE_BALL');
      return;
    }
    this._setLocomotion('walk');
    this.model.position.x += this.walkDirection * this.speed * dt;
    if (Math.abs(this.model.position.x) > 65) {
      this.walkDirection *= -1;
      this.model.rotation.y = this.walkDirection > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  _chaseBall(dt) {
    if (!this.model) return;
    this._setLocomotion('walk');
    const ballPos = this.getBallPosition();
    if (!ballPos) return this._finish('PATROL');

    this._lookAtTarget(ballPos);

    const direction = ballPos.clone().sub(this.model.position);
    direction.y = 0;
    const dist = direction.length();

    if (dist > 14.0) {
      direction.normalize();
      this.model.position.addScaledVector(direction, this.speed * 1.35 * dt);
    } else {
      this._chooseAction();
    }
  }

  _rage() {
    const t = Math.min(1, this.stateTime / 0.42);
    const hold = Math.min(1, Math.max(0, (1.45 - this.stateTime) / 0.35));
    const k = Math.max(t, hold);
    this._poseRoar(k);
    this.effects.rage?.(k);
    if (this.stateTime > 1.6) this._finish('CHASE_BALL');
  }

  _kickBall() {
    const ballPos = this.getBallPosition();
    if (ballPos) this._lookAtTarget(ballPos);
    const t = Math.min(1, this.stateTime / 0.9);
    this._poseKick(t);
    if (this.stateTime > 0.45 && !this._hit) {
      this._hit = true;
      this._ballImpulse(75);
      this.effects.kick?.(ballPos || undefined);
    }
    if (this.stateTime > 0.95) this._finish('CHASE_BALL');
  }

  _punchCar() {
    const car = this._nearestCar();
    const carPos = car ? this.getCarPosition(car) : null;
    if (carPos) this._lookAtTarget(carPos);
    const t = Math.min(1, this.stateTime / 0.85);
    this._posePunch(t);
    if (this.stateTime > 0.42 && !this._hit) {
      this._hit = true;
      this._carImpulse(55);
      this.effects.punch?.(carPos || undefined);
    }
    if (this.stateTime > 0.92) this._finish('CHASE_BALL');
  }

  _grabBall() {
    const ballPos = this.getBallPosition();
    if (ballPos) this._lookAtTarget(ballPos);
    const t = Math.min(1, this.stateTime / 0.8);
    this._poseGrab(t);
    if (this.stateTime > 0.42 && !this._hit) {
      this._hit = true;
      this._attachBallToHand();
      this.effects.grab?.(ballPos || undefined);
    }
    if (this.stateTime > 1.05) this._start('THROW_BALL');
  }

  _throwBall() {
    const t = Math.min(1, this.stateTime / 0.85);
    this._poseThrow(t);
    if (this.stateTime > 0.34 && !this._hit) {
      this._hit = true;
      this._releaseBallWithArc();
      this.effects.throw?.(this.getBallPosition() || undefined);
    }
    if (this.stateTime > 0.92) this._finish('CHASE_BALL');
  }

  _buttSlam() {
    const t = Math.min(1, this.stateTime / 1.25);
    this._poseSlam(t);
    if (this.model) {
      const jumpProgress = Math.sin(Math.PI * Math.min(1, this.stateTime / 1.1));
      this.model.position.y = Math.max(0, jumpProgress * 14.0);
    }
    if (this.stateTime > 0.78 && !this._hit) {
      this._hit = true;
      if (this.model) this.model.position.y = 0;
      this._radialImpulse();
      this.effects.slam?.(this.model?.position);
    }
    if (this.stateTime > 1.35) {
      if (this.model) this.model.position.y = 0;
      this._finish('CHASE_BALL');
    }
  }

  _recover() {
    if (this.stateTime > 0.4) this._finish('CHASE_BALL');
  }

  _poseRoar(k) {
    this._setEuler(this._bones.spine, -0.22 * k, 0, 0);
    this._setEuler(this._bones.leftUpperArm, -0.75 * k, 0, -0.35 * k);
    this._setEuler(this._bones.rightUpperArm, -0.75 * k, 0, 0.35 * k);
    this._setEuler(this._bones.leftForearm, -0.32 * k, 0, 0);
    this._setEuler(this._bones.rightForearm, -0.32 * k, 0, 0);
    if (this._bones.jaw) this._setEuler(this._bones.jaw, 0.55 * k, 0, 0);
  }

  _poseKick(t) {
    const k = Math.sin(Math.PI * t);
    this._setEuler(this._bones.spine, 0.22 * k, 0, 0);
    this._setEuler(this._bones.leftThigh, 0.22 * k, 0, 0);
    this._setEuler(this._bones.rightThigh, -1.25 * k, 0, 0);
    this._setEuler(this._bones.rightShin, 1.55 * k, 0, 0);
    this._setEuler(this._bones.rightFoot, -0.35 * k, 0, 0);
  }

  _posePunch(t) {
    const k = Math.sin(Math.PI * t);
    this._setEuler(this._bones.spine, 0, -0.45 * k, 0);
    this._setEuler(this._bones.rightUpperArm, -1.25 * k, -0.25 * k, -0.45 * k);
    this._setEuler(this._bones.rightForearm, -1.15 * k, 0, 0);
    this._setEuler(this._bones.leftUpperArm, 0.35 * k, 0, 0.25 * k);
  }

  _poseGrab(t) {
    const k = Math.sin(Math.PI * t);
    this._setEuler(this._bones.spine, 0.28 * k, 0, 0);
    this._setEuler(this._bones.leftUpperArm, -0.92 * k, 0, -0.85 * k);
    this._setEuler(this._bones.rightUpperArm, -0.92 * k, 0, 0.85 * k);
    this._setEuler(this._bones.leftForearm, -0.65 * k, 0, 0);
    this._setEuler(this._bones.rightForearm, -0.65 * k, 0, 0);
  }

  _poseThrow(t) {
    const k = Math.sin(Math.PI * t);
    this._setEuler(this._bones.spine, -0.35 * k, 0, 0);
    this._setEuler(this._bones.leftUpperArm, -1.35 * k, 0, -0.55 * k);
    this._setEuler(this._bones.rightUpperArm, -1.35 * k, 0, 0.55 * k);
    this._setEuler(this._bones.leftForearm, -0.45 * k, 0, 0);
    this._setEuler(this._bones.rightForearm, -0.45 * k, 0, 0);
  }

  _poseSlam(t) {
    const k = Math.sin(Math.PI * t);
    this._setEuler(this._bones.hips, 0.45 * k, 0, 0);
    this._setEuler(this._bones.spine, 0.85 * k, 0, 0);
    this._setEuler(this._bones.leftUpperArm, 1.15 * k, 0, -0.4 * k);
    this._setEuler(this._bones.rightUpperArm, 1.15 * k, 0, 0.4 * k);
    this._setEuler(this._bones.leftThigh, -0.65 * k, 0, 0);
    this._setEuler(this._bones.rightThigh, -0.65 * k, 0, 0);
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
    const ballObj = this.ball.mesh || this.ball;
    hand.attach(ballObj);
    ballObj.position.set(0, 1.5, 0);

    this.ball.userData = this.ball.userData || {};
    this.ball.userData.kongHeld = true;
    if (this.ball.mesh) this.ball.mesh.userData.kongHeld = true;

    this._heldBall = this.ball;
    this.physics.setKinematic?.(this.ball, true);
    this.physics.setSensor?.(this.ball, true);
  }

  _keepBallInHand() {
    if (!this._heldBall || !this._bones.rightHand) return;
    const ballObj = this._heldBall.mesh || this._heldBall;
    ballObj.position.set(0, 1.5, 0);
    ballObj.quaternion.identity();
    if (this._heldBall.pos) {
      ballObj.getWorldPosition(this._heldBall.pos);
    }
  }

  _releaseBallWithArc() {
    if (!this._heldBall || !this.model) return;
    const ball = this._heldBall;
    const ballObj = ball.mesh || ball;
    const worldPosition = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    ballObj.getWorldPosition(worldPosition);
    ballObj.getWorldQuaternion(worldQuaternion);

    this.scene.attach(ballObj);
    ballObj.position.copy(worldPosition);
    ballObj.quaternion.copy(worldQuaternion);
    if (ball.pos) ball.pos.copy(worldPosition);

    ball.userData = ball.userData || {};
    ball.userData.kongHeld = false;
    if (ball.mesh) ball.mesh.userData.kongHeld = false;

    this.physics.setSensor?.(ball, false);
    this.physics.setKinematic?.(ball, false);

    const direction = this.model.getWorldDirection(new THREE.Vector3());
    direction.y = 0.42;
    direction.normalize();
    this.physics.applyImpulse?.(ball, direction.multiplyScalar(75));
    this._heldBall = null;
  }

  _nearestCar() {
    const cars = (typeof this.cars === 'function' ? this.cars() : this.cars).filter(Boolean);
    if (!cars.length || !this.model) return null;
    return cars.sort((a, b) => {
      const pA = this.getCarPosition(a);
      const pB = this.getCarPosition(b);
      if (!pA || !pB) return 0;
      return this.model.position.distanceTo(pA) - this.model.position.distanceTo(pB);
    })[0];
  }

  _ballImpulse(force) {
    if (!this.ball || this.ball.userData?.kongHeld || !this.model) return;
    const bPos = this.getBallPosition();
    if (!bPos) return;
    const direction = bPos.clone().sub(this.model.position).normalize();
    direction.y = 0.28;
    direction.normalize();
    this.physics.applyImpulse?.(this.ball, direction.multiplyScalar(force));
  }

  _carImpulse(force) {
    const car = this._nearestCar();
    if (!car || !this.model) return;
    const cPos = this.getCarPosition(car);
    if (!cPos) return;
    const direction = cPos.clone().sub(this.model.position).normalize();
    direction.y = 0.65;
    direction.normalize();
    this.physics.applyImpulse?.(car, direction.multiplyScalar(force));
    this.physics.applyAngularImpulse?.(car, new THREE.Vector3(0, force * 0.4, force * 0.3));
  }

  _radialImpulse() {
    if (!this.model) return;
    const cars = typeof this.cars === 'function' ? this.cars() : this.cars;
    const objects = [this.ball, ...cars].filter(Boolean);
    for (const object of objects) {
      const objPos = object === this.ball ? this.getBallPosition() : this.getCarPosition(object);
      if (!objPos) continue;
      const direction = objPos.clone().sub(this.model.position);
      const distance = Math.max(0.1, direction.length());
      if (distance < this.impactRadius) {
        direction.normalize().multiplyScalar(48 * (1 - distance / this.impactRadius));
        direction.y = Math.max(direction.y, 0.45);
        this.physics.applyImpulse?.(object, direction);
        if (typeof object.applySpinOut === 'function') {
          object.applySpinOut(1.8);
        }
      }
    }
    this.camera?.shake?.(0.65, 0.85);
  }
}
