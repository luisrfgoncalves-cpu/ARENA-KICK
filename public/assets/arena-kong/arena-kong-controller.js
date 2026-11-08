import * as THREE from 'three';

/**
 * Kong Gorak — controlador genérico para Three.js + física do Arena Kick.
 * O GLB rigado continua sendo o visual; este controlador cria os golpes e impactos
 * sem depender de clipes pagos adicionais.
 */
export class KongGorakController {
  constructor({ model, scene, ball, cars = [], physics, goal = null, camera = null }) {
    this.model = model;
    this.scene = scene;
    this.ball = ball;
    this.cars = cars;
    this.physics = physics;
    this.goal = goal;
    this.camera = camera;
    this.state = 'PATROL';
    this.stateTime = 0;
    this.actionCooldown = 0;
    this.walkDirection = 1;
    this.speed = 2.1;
    this.attackRadius = 5.2;
    this.impactRadius = 7.5;
    this.rage = 0;
    this._bones = this._findBones(model);
    this._rest = new Map();
    this._bones.all.forEach((b) => this._rest.set(b, b.rotation.clone()));
  }

  _findBones(root) {
    const all = [];
    root.traverse((o) => { if (o.isBone) all.push(o); });
    const pick = (...words) => all.find((b) => words.some((w) => b.name.toLowerCase().includes(w)));
    return {
      all,
      hips: pick('hips', 'pelvis', 'root'),
      spine: pick('spine', 'chest', 'torso'),
      head: pick('head', 'neck'),
      jaw: pick('jaw', 'mouth'),
      leftUpperArm: pick('leftarm', 'lupperarm', 'upperarm_l', 'arm_l'),
      rightUpperArm: pick('rightarm', 'rupperarm', 'upperarm_r', 'arm_r'),
      leftForearm: pick('leftforearm', 'lforearm', 'forearm_l'),
      rightForearm: pick('rightforearm', 'rforearm', 'forearm_r'),
      leftHand: pick('lefthand', 'lhand', 'hand_l'),
      rightHand: pick('righthand', 'rhand', 'hand_r'),
      leftThigh: pick('leftthigh', 'lthigh', 'thigh_l'),
      rightThigh: pick('rightthigh', 'rthigh', 'thigh_r'),
      leftShin: pick('leftshin', 'lshin', 'calf_l'),
      rightShin: pick('rightshin', 'rshin', 'calf_r')
    };
  }

  update(dt) {
    if (!this.model) return;
    this.stateTime += dt;
    this.actionCooldown = Math.max(0, this.actionCooldown - dt);
    if (this.state === 'PATROL') this._patrol(dt);
    if (this.state === 'CHASE_BALL') this._chaseBall(dt);
    if (this.state === 'RAGE') this._rage(dt);
    if (this.state === 'KICK_BALL') this._animateKick(dt);
    if (this.state === 'PUNCH_CAR') this._animatePunch(dt);
    if (this.state === 'GRAB_BALL') this._animateGrab(dt);
    if (this.state === 'THROW_BALL') this._animateThrow(dt);
    if (this.state === 'BUTT_SLAM') this._animateButtSlam(dt);
    this._chooseAction();
  }

  _chooseAction() {
    if (this.actionCooldown > 0 || this.stateTime < 1.1) return;
    const ballDistance = this.ball ? this.model.position.distanceTo(this.ball.position) : 999;
    const nearest = this._nearestCar();
    const carDistance = nearest ? this.model.position.distanceTo(nearest.position) : 999;
    if (ballDistance < 3.0 && Math.random() < 0.22) return this._start('KICK_BALL');
    if (ballDistance < 2.0 && Math.random() < 0.10) return this._start('GRAB_BALL');
    if (carDistance < 3.0 && Math.random() < 0.16) return this._start('PUNCH_CAR');
    if (this.rage > 0.8 && Math.random() < 0.12) return this._start('BUTT_SLAM');
    if (Math.random() < 0.04) return this._start('RAGE');
  }

  _start(next) { this.state = next; this.stateTime = 0; this.actionCooldown = 2.0; }
  _patrol(dt) {
    this.model.position.x += this.walkDirection * this.speed * dt;
    if (Math.abs(this.model.position.x) > 18) this.walkDirection *= -1;
    this._poseWalk(this.stateTime * 7);
    const target = this.ball ? this.ball.position : null;
    if (target && this.model.position.distanceTo(target) < 8) this.state = 'CHASE_BALL';
  }
  _chaseBall(dt) {
    if (!this.ball) return this._start('PATROL');
    const d = this.ball.position.clone().sub(this.model.position); d.y = 0;
    if (d.length() > 2.4) { d.normalize(); this.model.position.addScaledVector(d, this.speed * 1.35 * dt); this.model.lookAt(this.ball.position.x, this.model.position.y, this.ball.position.z); this._poseWalk(this.stateTime * 8); }
    else this._start('PATROL');
  }
  _rage(dt) {
    this._poseRoar(this.stateTime);
    if (this.stateTime > 1.2) { this.rage = Math.max(0, this.rage - dt); this._start('PATROL'); }
  }

  _animateKick() {
    const t = Math.min(1, this.stateTime / .75); this._poseKick(t);
    if (this.stateTime > .38 && !this._hit) { this._hit = true; this._ballImpulse(0x18); }
    if (this.stateTime > .8) { this._hit = false; this._start('PATROL'); }
  }
  _animatePunch() {
    const t = Math.min(1, this.stateTime / .7); this._posePunch(t);
    if (this.stateTime > .32 && !this._hit) { this._hit = true; this._carImpulse(15); }
    if (this.stateTime > .78) { this._hit = false; this._start('PATROL'); }
  }
  _animateGrab() {
    const t = Math.min(1, this.stateTime / .9); this._poseGrab(t);
    if (this.stateTime > .45 && !this._hit) { this._hit = true; if (this.ball) this.ball.userData.kongHeld = true; }
    if (this.stateTime > 1.0) { this._hit = false; this._start('THROW_BALL'); }
  }
  _animateThrow() {
    const t = Math.min(1, this.stateTime / .75); this._poseThrow(t);
    if (this.stateTime > .3 && !this._hit) { this._hit = true; if (this.ball) { this.ball.userData.kongHeld = false; this._ballImpulse(28); } }
    if (this.stateTime > .8) { this._hit = false; this._start('PATROL'); }
  }
  _animateButtSlam() {
    const t = Math.min(1, this.stateTime / 1.15); this._poseSlam(t);
    if (this.stateTime > .72 && !this._hit) { this._hit = true; this._radialImpulse(); }
    if (this.stateTime > 1.25) { this._hit = false; this._start('PATROL'); }
  }

  _poseWalk(t) { this._rot(this._bones.leftUpperArm, 0, 0, Math.sin(t) * .18); this._rot(this._bones.rightUpperArm, 0, 0, -Math.sin(t) * .18); this._rot(this._bones.leftThigh, Math.sin(t) * .28, 0, 0); this._rot(this._bones.rightThigh, -Math.sin(t) * .28, 0, 0); }
  _poseRoar(t) { const k = Math.min(1, t * 4); this._rot(this._bones.spine, -.12 * k, 0, 0); this._rot(this._bones.leftUpperArm, -.55 * k, 0, -.2); this._rot(this._bones.rightUpperArm, -.55 * k, 0, .2); if (this._bones.jaw) this._bones.jaw.rotation.x = .45 * k; }
  _poseKick(t) { const k = Math.sin(Math.PI * t); this._rot(this._bones.rightThigh, -.9 * k, 0, 0); this._rot(this._bones.rightShin, 1.2 * k, 0, 0); this._rot(this._bones.spine, .18 * k, 0, 0); }
  _posePunch(t) { const k = Math.sin(Math.PI * t); this._rot(this._bones.rightUpperArm, -.9 * k, 0, -.4 * k); this._rot(this._bones.rightForearm, -.7 * k, 0, 0); }
  _poseGrab(t) { const k = Math.sin(Math.PI * t); this._rot(this._bones.leftUpperArm, -.65 * k, 0, -.7 * k); this._rot(this._bones.rightUpperArm, -.65 * k, 0, .7 * k); }
  _poseThrow(t) { const k = Math.sin(Math.PI * t); this._rot(this._bones.leftUpperArm, -.9 * k, 0, -.4 * k); this._rot(this._bones.rightUpperArm, -.9 * k, 0, .4 * k); }
  _poseSlam(t) { const k = Math.sin(Math.PI * t); this._rot(this._bones.spine, .55 * k, 0, 0); this._rot(this._bones.leftUpperArm, .9 * k, 0, -.3); this._rot(this._bones.rightUpperArm, .9 * k, 0, .3); }
  _rot(b, x, y, z) { if (b) { b.rotation.x += x; b.rotation.y += y; b.rotation.z += z; } }
  _nearestCar() { return this.cars.filter(Boolean).sort((a,b)=>this.model.position.distanceTo(a.position)-this.model.position.distanceTo(b.position))[0]; }
  _ballImpulse(force) { if (this.physics?.applyImpulse && this.ball) { const d = this.ball.position.clone().sub(this.model.position).normalize(); this.physics.applyImpulse(this.ball, d.multiplyScalar(force)); } }
  _carImpulse(force) { const car = this._nearestCar(); if (!car || !this.physics?.applyImpulse) return; const d = car.position.clone().sub(this.model.position).normalize(); this.physics.applyImpulse(car, d.multiplyScalar(force)); }
  _radialImpulse() { if (!this.physics?.applyImpulse) return; const objects = [this.ball, ...this.cars].filter(Boolean); for (const o of objects) { const d=o.position.clone().sub(this.model.position); const dist=Math.max(.1,d.length()); if(dist<this.impactRadius) this.physics.applyImpulse(o,d.normalize().multiplyScalar(22*(1-dist/this.impactRadius))); } this.camera?.shake?.(.45,.25); }
}
