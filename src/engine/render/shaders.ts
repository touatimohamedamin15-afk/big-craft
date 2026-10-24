/*
 * Chunk, sky and cloud shaders adapted from Voxelize
 * (https://github.com/voxelize/voxelize, packages/core/src/core/world/shaders.ts,
 * packages/core/src/shaders/sky, packages/core/src/shaders/clouds).
 * MIT License, Copyright (c) 2022 Shaoru Ian Huang.
 *
 * Kept: the packed per-vertex light word (sunlight nibble + ambient-occlusion
 * bits), the AO lookup table, face shades, hemisphere ambient, the
 * tunnel-darkening floor, the ACES-style light curve and the sky-gradient fog.
 * Dropped: water, shadows, block light, local lights, weather and greedy UVs.
 */
import { BackSide, Color, ShaderMaterial, Vector3, type Texture } from 'three'

export interface Environment {
  sunDirection: Vector3
  sunColor: Color
  ambientColor: Color
  sunlightIntensity: number
  minLightLevel: number
  skyTop: Color
  skyMiddle: Color
  skyBottom: Color
  fogNear: number
  fogFar: number
}

export function defaultEnvironment(): Environment {
  return {
    sunDirection: new Vector3(0.45, 1, 0.3).normalize(),
    sunColor: new Color(1, 0.97, 0.9),
    ambientColor: new Color(0.55, 0.6, 0.7),
    sunlightIntensity: 0.85,
    minLightLevel: 0.18,
    skyTop: new Color('#4f8fe6'),
    skyMiddle: new Color('#bfe0ff'),
    skyBottom: new Color('#3e5a86'),
    fogNear: 70,
    fogFar: 150,
  }
}

const SKY_UNIFORMS = /* glsl */ `
uniform vec3 uSkyTop;
uniform vec3 uSkyMiddle;
uniform vec3 uSkyBottom;
uniform float uSkyOffset;
uniform float uVoidOffset;
uniform float uExponent;
uniform float uExponent2;
uniform vec3 uSunDirection;

// Voxelize's sky gradient: middle to top above the horizon, middle to the
// void colour below, with separate offsets so the horizon band can sit low.
vec3 skyGradient(vec3 dir) {
  vec3 p = dir * 2000.0;
  float h = normalize(p + uSkyOffset).y;
  float h2 = normalize(p + uVoidOffset).y;
  vec3 color = mix(uSkyMiddle, uSkyTop, max(pow(max(h, 0.0), uExponent), 0.0));
  return mix(color, uSkyBottom, max(pow(max(-h2, 0.0), uExponent2), 0.0));
}
`

function skyUniforms(env: Environment) {
  return {
    uSkyTop: { value: env.skyTop },
    uSkyMiddle: { value: env.skyMiddle },
    uSkyBottom: { value: env.skyBottom },
    uSkyOffset: { value: 0 },
    uVoidOffset: { value: 1200 },
    uExponent: { value: 0.6 },
    uExponent2: { value: 1.2 },
    uSunDirection: { value: env.sunDirection },
  }
}

/**
 * The block material. `translucent` makes the blended variant for stained glass:
 * it keeps the texture's alpha instead of cutting it out, and writes no depth.
 */
export function createChunkMaterial(atlas: Texture, atlasSize: number, env: Environment, translucent = false): ShaderMaterial {
  return new ShaderMaterial({
    ...(translucent ? { transparent: true, depthWrite: false, defines: { TRANSLUCENT: '' } } : {}),
    uniforms: {
      map: { value: atlas },
      uAtlasSize: { value: atlasSize },
      // Voxelize's default AO table: corner darkness for 0..3 open neighbours.
      uAOTable: { value: [45 / 255 + 0.2, 105 / 255 + 0.12, 180 / 255 + 0.05, 1] },
      uSunColor: { value: env.sunColor },
      uAmbientColor: { value: env.ambientColor },
      uSunlightIntensity: { value: env.sunlightIntensity },
      uMinLightLevel: { value: env.minLightLevel },
      uFaceShades: { value: [0.78, 0.88, 0.62, 1] },
      uFogNear: { value: env.fogNear },
      uFogFar: { value: env.fogFar },
      ...skyUniforms(env),
    },
    vertexShader: /* glsl */ `
      attribute float light;
      uniform float uAOTable[4];
      varying vec2 vUv;
      varying float vAO;
      varying float vSun;
      varying float vBlock;
      varying vec3 vWorldPos;
      varying vec3 vNormal;

      void main() {
        // Bit map mirrors Voxelize's vertex_light.rs: sun in 12..15, AO in 16..17.
        int l = int(light + 0.5);
        vAO = uAOTable[(l >> 16) & 3];
        vSun = float((l >> 12) & 15) / 15.0;
        vBlock = float((l >> 8) & 15) / 15.0;
        vUv = uv;
        vNormal = normal;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float uAtlasSize;
      uniform vec3 uSunColor;
      uniform vec3 uAmbientColor;
      uniform float uSunlightIntensity;
      uniform float uMinLightLevel;
      uniform vec4 uFaceShades;
      uniform float uFogNear;
      uniform float uFogFar;
      ${SKY_UNIFORMS}
      varying vec2 vUv;
      varying float vAO;
      varying float vSun;
      varying float vBlock;
      varying vec3 vWorldPos;
      varying vec3 vNormal;

      void main() {
        // Clamp the UV gradient to half a tile so mip selection never reaches
        // across the padded cell into a neighbouring texture.
        vec2 gx = dFdx(vUv);
        vec2 gy = dFdy(vUv);
        float tile = 0.5 / uAtlasSize;
        gx *= min(1.0, tile * 0.5 / max(length(gx), 1e-8));
        gy *= min(1.0, tile * 0.5 / max(length(gy), 1e-8));
        vec4 tex = textureGrad(map, vUv, gx, gy);
        #ifdef TRANSLUCENT
        if (tex.a < 0.02) discard;
        #else
        if (tex.a < 0.5) discard;
        #endif

        vec3 n = normalize(vNormal);
        float NdotL = max(dot(n, uSunDirection) * 0.85 + 0.15, 0.0);
        vec3 sunContribution = uSunColor * NdotL * uSunlightIntensity * vSun;

        float hemisphere = n.y * 0.5 + 0.5;
        vec3 skyAmbient = mix(uAmbientColor * 0.4, uAmbientColor, hemisphere);
        float tunnelDarkening = mix(uMinLightLevel, 1.0, vSun);

        vec3 shadeWeights = abs(n);
        shadeWeights /= max(shadeWeights.x + shadeWeights.y + shadeWeights.z, 0.0001);
        float vertical = n.y > 0.0 ? uFaceShades.w : uFaceShades.z;
        float faceShade = shadeWeights.x * uFaceShades.x + shadeWeights.z * uFaceShades.y + shadeWeights.y * vertical;

        vec3 total = skyAmbient * tunnelDarkening * 0.55 + sunContribution + uAmbientColor * uMinLightLevel * 0.3;
        // Lamp light: warm, falling off faster than linear (Voxelize's block-light curve, simplified).
        vec3 lamp = vec3(1.0, 0.78, 0.5) * pow(vBlock, 1.6) * 1.15;
        total = 1.0 - (1.0 - total) * (1.0 - lamp);
        total *= vAO * faceShade;
        // ACES-style curve on the light (Voxelize applies it here rather than as a renderer tone map).
        total = (total * (2.51 * total + 0.03)) / (total * (2.43 * total + 0.59) + 0.14);
        vec3 color = tex.rgb * total * 1.25;

        vec3 toFrag = vWorldPos - cameraPosition;
        float fog = smoothstep(uFogNear, uFogFar, length(toFrag.xz));
        color = mix(color, skyGradient(normalize(toFrag)), fog);
        #ifdef TRANSLUCENT
        gl_FragColor = vec4(color, tex.a);
        #else
        gl_FragColor = vec4(color, 1.0);
        #endif
        #include <colorspace_fragment>
      }
    `,
  })
}

export function createSkyMaterial(env: Environment): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { ...skyUniforms(env), uSunColor: { value: env.sunColor } },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${SKY_UNIFORMS}
      uniform vec3 uSunColor;
      varying vec3 vWorldPosition;
      void main() {
        // View-relative, as in Voxelize, so the gradient never seams around the origin.
        vec3 dir = normalize(vWorldPosition - cameraPosition);
        vec3 color = skyGradient(dir);
        float sunCos = dot(dir, uSunDirection);
        float sunAngle = sqrt(max(2.0 - 2.0 * sunCos, 0.0));
        float disc = 1.0 - smoothstep(0.035, 0.045, sunAngle);
        float glow = exp(-sunAngle * 6.0) * 0.35;
        color += uSunColor * (disc * 1.4 + glow);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
}

export function createCloudMaterial(env: Environment): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...skyUniforms(env),
      uCloudColor: { value: new Color(1, 1, 1) },
      uCloudAlpha: { value: 0.82 },
      uCloudSideShade: { value: 0.86 },
      uCloudBottomShade: { value: 0.7 },
      uCloudSunTint: { value: 0.12 },
      uFogNear: { value: env.fogNear * 2 },
      uFogFar: { value: env.fogFar * 2.4 },
    },
    vertexShader: /* glsl */ `
      varying vec4 vWorldPosition;
      varying vec3 vCloudNormal;
      void main() {
        vWorldPosition = modelMatrix * vec4(position, 1.0);
        vCloudNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${SKY_UNIFORMS}
      uniform vec3 uCloudColor;
      uniform float uCloudAlpha;
      uniform float uCloudSideShade;
      uniform float uCloudBottomShade;
      uniform float uCloudSunTint;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec4 vWorldPosition;
      varying vec3 vCloudNormal;
      void main() {
        // Voxelize's cloud shading: top, shadowed underside and flanks, a touch
        // darker away from the sun.
        float shade = vCloudNormal.y > 0.5 ? 1.0 : (vCloudNormal.y < -0.5 ? uCloudBottomShade : uCloudSideShade);
        float towardSun = max(0.0, dot(vCloudNormal, normalize(uSunDirection)));
        shade *= mix(1.0 - uCloudSunTint, 1.0, towardSun);
        vec3 toFrag = vWorldPosition.xyz - cameraPosition;
        float fade = smoothstep(uFogNear, uFogFar, length(toFrag.xz));
        vec3 color = mix(uCloudColor * shade, skyGradient(normalize(toFrag)), fade);
        gl_FragColor = vec4(color, uCloudAlpha * (1.0 - fade));
        #include <colorspace_fragment>
      }
    `,
  })
}
