
## Movimentos completos solicitados

O controlador corrigido implementa os estados PATROL, CHASE_BALL, IDLE, RAGE/ROAR, KICK_BALL, PUNCH_CAR, GRAB_BALL, HOLD_BALL, THROW_BALL, BUTT_SLAM, CAR_IMPACT, BALL_REDIRECT e RECOVER.

O GLB possui clipes reais gravados para `idle`, `standing_relax` e `walk`. Os ataques e interações são animações procedurais articuladas sincronizadas com física: chute com perna, soco/tapa com braço, agarrar e segurar a bola na mão, arremesso balístico, salto e queda de bunda, rugido, impacto em carros e redirecionamento da bola.

Durante os ataques, o controlador deve pausar o `AnimationMixer`, restaurar a pose base e aplicar a pose procedural com easing. Ao terminar, deve retomar o clipe de locomoção. A ordem do loop deve ser:

```js
mixer.update(dt);
controller.update(dt);
```

Passe `mixer` e `clips` ao construtor. Não use o controlador anterior, que acumulava rotações e podia ser sobrescrito pelo mixer.

A bola deve ser anexada ao osso `rightHand` durante `GRAB_BALL`/`HOLD_BALL`. Durante `THROW_BALL`, desanexe a bola, restaure a física dinâmica e aplique impulso linear para frente e para cima. O impacto nos carros deve aplicar impulso linear e angular. O `BUTT_SLAM` deve aplicar o impacto radial uma única vez no contato com o chão.

Esses ataques são procedurais e não clipes artísticos independentes gravados no GLB. Se forem necessários clipes capturados com qualidade cinematográfica, eles precisam ser gerados separadamente e retargetados ao rig.
