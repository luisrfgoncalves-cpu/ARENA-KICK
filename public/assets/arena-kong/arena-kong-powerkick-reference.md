# Referência externa — Arena Power-Kick

Fonte pública consultada em 2026-11-08:
- Jogo: https://arena-kick.vercel.app/
- Módulo 3D: https://arena-kick.vercel.app/assets/turbosoccer-t8wmNXf1.js

Constantes encontradas no módulo Turbo Soccer:
- P = 220: largura principal do campo em unidades Three.js.
- M = 360: comprimento principal do campo em unidades Three.js.
- ve = 58: teto/altura máxima da arena.
- Y = 2.2: raio da bola.
- j = 48: largura aproximada da abertura do gol.
- X = 17: altura aproximada da trave.
- Z = 18: profundidade do gol/estrutura próxima ao gol.
- Bi = 30: parâmetro adicional do jogo.

Limites de condução encontrados:
- x aproximado: P/2 - 2.8 = 107.2 em cada lado.
- z aproximado: M/2 - 2.8 = 177.2 em cada lado, fora da região do gol.
- teto de movimentação: y = 28 para os carros.

Elementos fixos encontrados no código 3D:
- campo procedural 220 x 360;
- linhas brancas, linha central, círculo central e áreas dos gols;
- bordas laterais de aproximadamente 2 unidades;
- paredes de vidro transparentes nas laterais e teto na altura 58;
- arquibancadas nos quatro lados, usando repetição de módulos;
- oito módulos de arquibancada por lado;
- telhado perimetral a aproximadamente y = 13.5;
- placares nas extremidades, com dimensão visual aproximada 56 x 21;
- placares posicionados em z = ±(M/2 + Z*0.45);
- gols em z = ±M/2;
- postes com separação j = 48 e altura X = 17;
- rede com profundidade Z = 18;
- dugouts laterais;
- refletores/floodlights;
- bandeiras de canto;
- céu/backdrop diurno: /assets/environment/arena-kick-backdrop-day.webp;
- céu/backdrop noturno: /assets/environment/arena-kick-backdrop-night.webp;
- nuvens decorativas no horizonte;
- público cartoon em painéis/instâncias;
- placas LED laterais;
- moedas, caixas misteriosas e launch pads no modo clássico/rumble — não devem ser copiados para a Arena Kong, salvo se desejado.

Observação: a página pública descreve o modo como Turbo Soccer 3D e usa Three.js. O código consultado é a referência das proporções atuais; para a Arena Kong, manter o mesmo footprint do campo e trocar apenas tema, cenário, obstáculos e lógica do gorila.
