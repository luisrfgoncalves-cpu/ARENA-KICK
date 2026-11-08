# Arena Kong — Kong Gorak

## Pacote concluído

Arquivos principais:

- `arena-kong-gorak.glb`: modelo 3D texturizado.
- `arena-kong-gorak-rigged.glb`: modelo com esqueleto bípede.
- `arena-kong-gorak-animated.glb`: modelo com os clipes oficiais `idle`, `standing_relax` e `walk`.
- `arena-kong-controller.js`: IA, poses procedurais, golpes e impulsos de física.
- `animation-manifest.json`: nomes dos arquivos, clipes e ações.

O GLB animado foi verificado estruturalmente: contém 3 animações, cada uma com 123 canais:

```text
idle             15.367 s — loop
standing_relax   17.600 s — loop
walk              2.367 s — loop
```

As ações de gameplay — chute, soco, agarrar, arremessar e queda de bunda — são controladas pelo `arena-kong-controller.js`, porque precisam sincronizar animação, colisão, impulso e câmera. Não devem ser substituídas por uma simples troca de cor ou por um sprite.

## Integração

Copie para a pasta pública:

```text
public/assets/arena-kong/arena-kong-gorak-animated.glb
public/assets/arena-kong/arena-kong-controller.js
public/assets/arena-kong/animation-manifest.json
```

Carregue o GLB animado:

```js
const gltf = await new GLTFLoader().loadAsync('/assets/arena-kong/arena-kong-gorak-animated.glb');
const kong = gltf.scene;
arena.add(kong);
const mixer = new THREE.AnimationMixer(kong);
const clips = Object.fromEntries(gltf.animations.map((clip) => [clip.name, clip]));
const idle = mixer.clipAction(clips.idle);
idle.setLoop(THREE.LoopRepeat, Infinity).play();
```

No loop principal:

```js
mixer.update(dt);
controller.update(dt);
```

Use também o `arena-kong-controller.js` para os eventos de física.

## Regras da Arena Kong

- Kong Gorak não pertence a nenhum time.
- Ele ataca jogadores e bots igualmente.
- Ele pode impedir qualquer gol.
- Patrulha de uma lateral à outra.
- Prioriza bloquear uma bola próxima do gol.
- Nunca recebe pontuação ou crédito por um gol.
- Não desaparece quando um time marca gol.
- Ataques respeitam cooldown.

## Colisores recomendados

Use corpos invisíveis simples:

```text
gorak-body
gorak-left-hand
gorak-right-hand
gorak-left-foot
gorak-right-foot
gorak-impact-zone
gorak-grab-zone
```

## Eventos visuais e físicos

- `KICK_BALL`: efeito de chute e impulso na bola.
- `PUNCH_CAR`: som, partículas e impulso no carro.
- `GRAB_BALL`: prende a bola brevemente na mão.
- `THROW_BALL`: solta a bola e aplica impulso para longe.
- `BUTT_SLAM`: poeira, câmera tremendo e impulso radial.
- `RAGE`: rugido, olhos ciano e agressividade aumentada.

## Prompt para o Antigravity

```text
Integre a Arena Kong usando arena-kong-gorak-animated.glb, arena-kong-controller.js e animation-manifest.json.

Kong Gorak é um obstáculo neutro controlado por IA. Ele não pertence a nenhum time e ataca jogadores e bots igualmente. Preserve o modelo 3D, a textura marrom escura, os olhos ciano e os detalhes do rosto.

Use AnimationMixer para os clipes idle, standing_relax e walk. Use arena-kong-controller.js para PATROL, CHASE_BALL, KICK_BALL, PUNCH_CAR, GRAB_BALL, THROW_BALL, BUTT_SLAM, RAGE e RECOVER. Adapte somente physics.applyImpulse para a física já existente.

Kong deve andar pela arena, observar a bola, bloquear chutes perto do gol, chutar a bola, bater nos carros, agarrar a bola, arremessá-la longe e produzir impacto radial ao cair sentado. Afete carros, bola e bots, mas nunca atribua time ou pontuação a Kong.

Adicione cooldowns, limites da arena, colisores invisíveis, poeira, impacto, tremor de câmera e brilho ciano nos olhos durante RAGE. Não remova os modos Power-Kick e não altere outras arenas. Não substitua a textura por uma cor única e não transforme Kong em sprite durante a partida.
```
