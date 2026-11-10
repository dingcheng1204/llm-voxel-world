import * as THREE from 'three';

export const MAX_LIGHTS = 8;

/**
 * Lighting shared by every chunk material, driven by the day/night cycle:
 *  - uLight: overall light colour (white at noon, warm at sunset, dim blue at night)
 *  - uNight: 0 at day → 1 at night (campfires glow stronger at night)
 *  - uFirePos / uFireCount: warm point glows around fire blocks (computed per pixel, no extra lights)
 */
export const blockLighting = {
  uLight: { value: new THREE.Color(1, 1, 1) },
  uNight: { value: 0 },
  uFireCount: { value: 0 },
  uFirePos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
};

function patch(material: THREE.Material, tint: boolean): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, blockLighting);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCellPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvCellPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCellPos;
        uniform vec3 uLight;
        uniform float uNight;
        uniform int uFireCount;
        uniform vec3 uFirePos[${MAX_LIGHTS}];`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${
          tint
            ? `// Per-block brightness variation (±7 %), per block cell so greedy-merged quads still look hand-painted.
        vec3 faceN = normalize(cross(dFdx(vCellPos), dFdy(vCellPos))); // points towards the viewer
        vec3 cell = floor(vCellPos - faceN * 0.5);
        float cellHash = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        diffuseColor.rgb *= 0.93 + 0.14 * cellHash;`
            : ''
        }
        vec3 lightCol = uLight;
        float glow = 0.0;
        for (int i = 0; i < ${MAX_LIGHTS}; i++) {
          if (i >= uFireCount) break;
          float d = distance(vCellPos, uFirePos[i]);
          glow += pow(max(0.0, 1.0 - d / 9.0), 2.0);
        }
        lightCol += vec3(1.0, 0.6, 0.3) * glow * (0.15 + 0.95 * uNight);
        diffuseColor.rgb *= lightCol;`,
      );
  };
}

// One material per pass, shared by every chunk → minimal state changes per draw call.
export const opaqueMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
patch(opaqueMaterial, true);

export const waterMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
});
patch(waterMaterial, false);
