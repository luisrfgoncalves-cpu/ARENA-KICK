# PROMPT MESTRE DE PRODUÇÃO 3D: KONG GORAK (ARENA KONG)
# DESTINO: ARENA KICK (THREE.JS / WEBGL 60 FPS)

Você é um Lead 3D Technical Artist e Engenheiro de Animação de Jogos.
Sua missão é produzir o asset 3D final completo do chefe colossal neutro "Kong Gorak" para a "Arena Kong" do jogo estilo Rocket League "Arena Kick".

O modelo anterior foi rejeitado porque os socos eram desferidos na horizontal a 18 metros de altura (socando o céu enquanto carros e bola ficavam na grama), o gorila andava com os braços abertos em T-pose dura, o pulo de bunda era reto como um elevador e os clipes de animação continham apenas 2 keyframes estáticos com o corpo congelado.

Você deve entregar um arquivo GLB 2.0 impecável, totalmente articulado, com animações orgânicas de peso real (padrão Motion Capture / Mixamo / Blender), onde os ataques de fato descem e esmagam o solo.

---

### 1. ESPECIFICAÇÕES DE MALHA E OTIMIZAÇÃO (WEBGL REAL-TIME)
* **Formato de Entrega:** Arquivo único `.glb` binário autocontido (malha + esqueleto + materiais + texturas + animações embutidas).
* **Contagem de Polígonos:** Entre 18.000 e 28.000 triângulos (Low/Mid-poly estilizado cartoon robusto, otimizado para 60 FPS estáveis sem travamento).
* **Materiais e Texturas:** 1 único material PBR. Texturas compactadas em 2048x2048 (Albedo/BaseColor em sRGB, Normal Map, Roughness/Metallic combinados).
* **Pivô e Orientação Obrigatória:**
  * Eixo Frontal: **-Z** (Forward = -Z, Up = +Y). O gorila deve olhar rigorosamente para -Z em repouso.
  * Ponto Pivô (0, 0, 0): Rigorosamente na sola dos pés no nível do chão (Y = 0).

---

### 2. RIGGING E ARTICULAÇÃO COMPLETA (ESQUELETO)
O esqueleto deve ser limpo e exportável, contendo obrigatoriamente:
* **Espinha e Tronco:** `Root`, `Hips`, `Pelvis`, `Spine01`, `Spine02`, `Neck`, `Head`.
* **Articulação Facial:** Osso `Jaw` (mandíbula móvel com abertura ampla para rugidos reais) e ossos de olhos/sobrancelhas (`L_Eye`, `R_Eye`, `L_Brow`, `R_Brow`).
* **Braços e Ombros:** `L_Clavicle`, `R_Clavicle`, `L_Upperarm`, `R_Upperarm`, `L_Forearm`, `R_Forearm`, `L_Hand`, `R_Hand`.
* **Dedos Riggados Individualmente (3 falanges cada):**
  * Mão Esquerda: `L_Thumb_01..03`, `L_Index_01..03`, `L_Middle_01..03`, `L_Ring_01..03`, `L_Pinky_01..03`.
  * Mão Direita: `R_Thumb_01..03`, `R_Index_01..03`, `R_Middle_01..03`, `R_Ring_01..03`, `R_Pinky_01..03`.
  * *Pintura de Pesos (Skin Weights):* Os dedos devem fechar punhos sólidos de soco e conchas de agarre sem rasgar a malha.
* **Pernas e Pés:** `L_Thigh`, `R_Thigh`, `L_Calf`, `R_Calf`, `L_Foot`, `R_Foot`, `L_Toe`, `R_Toe`.
* **Marcadores de Hitbox (Nós auxiliares):** `Hitbox_L_Hand`, `Hitbox_R_Hand`, `Hitbox_R_Foot`, `Hitbox_Pelvis`, `Ball_Hold_Point`.

---

### 3. CLIPES DE ANIMAÇÃO OBRIGATÓRIOS (60 FPS, PESO E INÉRCIA REAIS)
É TERMINANTEMENTE PROIBIDO exportar animações com 2 keyframes repetidos ou poses congeladas. Todos os ossos do corpo devem se mover harmonicamente com peso biológico real (estilo captura de movimento de feras / gorilas):

1. **`idle` (Loop, ~2.0s):**
   * Postura de gorila quadrupedal natural: coluna suavemente curvada, peito infla ao respirar, os nós dos dedos descansam perto da grama, peso do corpo oscila com vida orgânica. Nada de braços esticados de lado.

2. **`walk` (Loop, ~1.2s):**
   * Caminhada pesada de gorila colossal (Gorilla Beast Walk). Os ombros balançam alternadamente, as patas dianteiras tocam o chão ritmicamente, pernas arqueadas e pés firmes na grama sem efeito de deslizar no gelo.

3. **`punch_left` & `punch_right` (Once, ~1.0s cada) — OBRIGATÓRIO: SOCO NO CHÃO (GROUND POUND):**
   * Como os carros têm 1.4m e a bola tem 2m, o soco NÃO pode ser no alto.
   * O gorila recua o tronco, ergue o braço com o punho fechado e **DESCE COM TODO O PESO DO CORPO**, curvando a coluna 45° para baixo e martelando o punho fechado contra a grama (Y = 0 a 1.5m).

4. **`kick_ball` (Once, ~1.05s) — CHUTE RASTEIRO:**
   * O gorila transfere o peso para a perna de apoio, inclina o tronco e desfere uma varredura potente rente à grama, atingindo a bola e carros com a sola e peito do pé.

5. **`grab_ball` (Once, ~0.9s):**
   * O gorila se agacha, desce os dois braços até o solo, abre os dedos das mãos em concha e recolhe a bola junto ao solo, trazendo-a para o corpo.

6. **`hold_ball` (Loop, ~1.0s):**
   * Gorila segurando a bola firme com as mãos/peito enquanto se mantém em pose de confronto.

7. **`throw_ball` (Once, ~0.95s):**
   * O gorila ergue a bola acima da cabeça com as duas mãos e arremessa violentamente para frente em trajetória balística, esticando os braços no release.

8. **`butt_slam` (Once, ~2.4s) — QUEDA DE BUNDA DINÂMICA:**
   * **Subida (0.0s - 0.8s):** Gorila flexiona os joelhos no chão, salta explodindo para o alto com o peito estufado e braços erguidos.
   * **Ápice no Ar (0.8s - 1.4s):** Encolhe os joelhos contra o peito (tuck), posiciona o quadril e a pelve projetados para baixo.
   * **Queda e Impacto (1.4s - 2.0s):** Desce em queda livre acelerada e colide o bumbum/pelve com impacto violento na grama (Y = 0), achatando o corpo no solo e absorvendo o impacto.
   * **Recuperação (2.0s - 2.4s):** Apoia os punhos no chão e volta à postura de combate.

9. **`roar_rage` (Once, ~1.6s):**
   * Gorila para, bate repetidamente no peito com os punhos fechados (Chest Beat), abre a mandíbula (`Jaw`) em 40° soltando um rugido furioso para o céu e projeta a cabeça para frente.

---

### 4. CRITÉRIOS DE ACEITAÇÃO
* O arquivo GLB deve abrir perfeitamente no Three.js `GLTFLoader` sem erros de validação Khronos glTF.
* Todos os 11 clipes devem aparecer em `gltf.animations` com seus nomes exatos em minúsculas (`idle`, `walk`, `punch_left`, `punch_right`, `kick_ball`, `grab_ball`, `hold_ball`, `throw_ball`, `butt_slam`, `roar_rage`).
* O bone `Jaw` e os 30 bones de dedos devem acompanhar a malha sem deformações distorcidas.
* O soco deve descer até a sola dos pés (nível do gramado).

