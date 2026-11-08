# Fundos panorâmicos do Arena Kick

`arena-kick-backdrop-day.webp` e `arena-kick-backdrop-night.webp` são as versões otimizadas para o navegador. Os PNGs originais também estão incluídos para edição futura.

Os fundos foram criados para ocupar o horizonte atrás do campo: montanhas, cidade distante, prédios genéricos, nuvens, lua e refletores. Eles não devem ser aplicados sobre o gramado.

A implementação recomendada é um cilindro muito grande, aberto por cima e por baixo, com material `MeshBasicMaterial` voltado para dentro. Coloque esse cilindro longe do centro do campo, atrás das arquibancadas. Use a versão diurna no cenário `☀️ DIURNO` e a noturna no cenário `🌙 NOTURNO`.

Exemplo de orientação:

```js
const texture = new THREE.TextureLoader().load(
  '/assets/environment/arena-kick-backdrop-day.webp'
);
texture.colorSpace = THREE.SRGBColorSpace;
texture.wrapS = THREE.RepeatWrapping;

const material = new THREE.MeshBasicMaterial({
  map: texture,
  side: THREE.BackSide,
  depthWrite: false
});

const backdrop = new THREE.Mesh(
  new THREE.CylinderGeometry(180, 180, 90, 64, 1, true),
  material
);
backdrop.position.y = 35;
backdrop.renderOrder = -10;
scene.add(backdrop);
```

A escala `180` é apenas um ponto de partida. O Antigravity deve ajustar o raio e a altura à escala real do estádio. Se a câmera puder olhar muito para cima, adicione também uma cor de céu ou um plano superior discreto para não deixar um buraco no topo.
