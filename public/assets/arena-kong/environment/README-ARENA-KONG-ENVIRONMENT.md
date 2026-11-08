# Cenário da Arena Kong

Este pacote usa as proporções reais encontradas no modo Turbo Soccer 3D do Arena Kick. O campo continua com 220 x 360 unidades, teto em 58, abertura do gol em 48, altura de trave em 17 e profundidade de gol em 18.

O arquivo `arena-kong-environment.js` carrega o kit do estádio, a floresta, as ruínas e o backdrop. A camada estática recebe `userData.physics = 'none'` para que árvores, ruínas, placas e arquibancadas não interfiram na bola ou nos carros.

## Arquivos

- `arena-kong-stadium-kit.glb`: arquibancadas, placares, refletores, dugouts, cercas e estruturas do estádio.
- `arena-kong-jungle-kit.glb`: árvores, raízes, cipós, rochas, vegetação e peças de floresta.
- `arena-kong-cliffs-ruins.glb`: penhascos, ruínas, portais e elementos monumentais para o horizonte.
- `arena-kong-backdrop-day.webp`: floresta diurna com montanhas e cachoeiras.
- `arena-kong-backdrop-night.webp`: floresta noturna com lua, tochas e neblina.
- `arena-kong-environment-manifest.json`: medidas e posicionamento.
- `arena-kong-environment.js`: loader Three.js e limites de área jogável.

## Integração

Copie a pasta para:

```text
public/assets/arena-kong/environment/
```

Depois carregue uma vez quando a Arena Kong for criada:

```js
import { loadArenaKongEnvironment } from './assets/arena-kong/environment/arena-kong-environment.js';
await loadArenaKongEnvironment(scene, { mode: 'day' });
```

Para a versão noturna:

```js
await loadArenaKongEnvironment(scene, { mode: 'night' });
```

## Regras importantes

O campo, gols, carros, bola e física atuais devem ser preservados. O cenário externo deve ficar fora da área jogável aproximada `x = -107.2..107.2` e `z = -177.2..177.2`. Não adicione colisores aos assets decorativos. As colisões devem continuar usando as paredes e gols existentes do jogo.

As moedas, caixas de poder, launch pads e outros elementos exclusivos do rumble da Power-Kick não fazem parte deste kit, porque a Arena Kong tem como foco o gorila neutro e a floresta selvagem.

## Prompt curto para o Antigravity

```text
Integre a pasta arena-kong/environment usando arena-kong-environment.js.

Mantenha o campo existente com 220 x 360, teto 58, gols com abertura 48, trave 17 e profundidade 18. Não altere a física, gols, carros ou controles da Power-Kick.

Carregue stadium-kit, jungle-kit e cliffs-ruins como camada estática sem colisão. Use backdrop-day.webp de dia e backdrop-night.webp à noite. Posicione o cenário fora de x=-107.2..107.2 e z=-177.2..177.2. Preserve arquibancadas, placares, refletores, dugouts, paredes e traves, mas troque a ambientação por floresta tropical, penhascos, ruínas, cachoeiras, cipós, neblina e tochas.

Depois carregue arena-kong-gorak-animated.glb e arena-kong-controller.js. Teste a câmera, a escala, o campo livre e o Kong sem alterar as outras arenas.
```
