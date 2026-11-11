// The character's final look: a warm backlight, cool sky fill, the blue spark light from the blade,
// plus shader additions on the scanned materials (rim light, light bleeding through skin and hair
// tips, glowing eyes) and a light bloom. look.set({ look:false }) falls back to plain even lighting.
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createLook(THREE, renderer, scene, camera, Q) {
  const num = (k, d) => +(Q.get(k) ?? d);
  const BG_FINAL = new THREE.Color(0x2b313b), BG_FLAT = new THREE.Color(0x8a8f98);

  // ---- lights
  const flat = new THREE.Group(), rig = new THREE.Group(); scene.add(flat, rig);
  flat.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2.2));
  const flatSun = new THREE.DirectionalLight(0xffffff, 2); flatSun.position.set(1, 2, 3); flat.add(flatSun);

  const sky = new THREE.HemisphereLight(0xcdd0d8, 0x70645c, num('sky', 1.15)); rig.add(sky);
  const key = new THREE.DirectionalLight(0xffc890, num('key', 4.2));               // low sun behind her, off to her left
  key.position.set(num('kx', 1.0), num('ky', 1.5), num('kz', -1.9)); key.target.position.set(0, 0.7, 0);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.006; key.shadow.radius = 3;
  Object.assign(key.shadow.camera, { left: -0.8, right: 0.8, top: 0.75, bottom: -0.85, near: 0.5, far: 5 });
  const fill = new THREE.DirectionalLight(0xe4dcd6, num('fill', 0.8)); fill.position.set(-0.6, 0.6, 2);   // sky bounce on the face
  const spark = new THREE.PointLight(0x7fbfff, 0, 1.6, 1.6); spark.position.set(-0.05, 0.62, 0.42);        // where the blade leaves the sheath
  rig.add(key, key.target, fill, spark);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // ---- shader additions shared by every dressed material
  const U = {
    uOn: { value: 1 }, uBack: { value: new THREE.Vector3() }, uKeyCol: { value: new THREE.Color(0xffc890) },
    uRim: { value: num('rim', 1.1) }, uSSS: { value: num('sss', 0.55) }, uGlow: { value: 0 }, uSpark: { value: 0 },
  };
  function dress(mesh, o) {
    const m = mesh.material; mesh.castShadow = mesh.receiveShadow = true;
    m.metalness = 0; m.metalnessMap = null;                   // no environment map: metal would only go black
    let eyes = [new THREE.Vector3(), new THREE.Vector3()], gap = 0;
    if (o.eyes) {                                             // given in the space of o.root; the shader compares raw vertex positions
      o.root.updateMatrixWorld(true);
      const M = mesh.matrixWorld.clone().invert().multiply(o.root.matrixWorld);
      eyes = o.eyes.map(e => e.clone().applyMatrix4(M)); gap = eyes[0].distanceTo(eyes[1]);
    }
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U, { uEyeR: { value: eyes[0] }, uEyeL: { value: eyes[1] }, uEyeRad: { value: gap * 0.42 } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vObj;
        uniform float uOn, uRim, uSSS, uGlow, uSpark, uEyeRad; uniform vec3 uBack, uKeyCol, uEyeR, uEyeL;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        if (uOn > 0.5) diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.015, 0.07, dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1))));   // keep sunlit hair near black`)
        .replace('#include <opaque_fragment>', `
        if (uOn > 0.5) {
          vec3 V = normalize(vViewPosition), alb = diffuseColor.rgb;
          float lum = dot(alb, vec3(0.3, 0.6, 0.1));
          float skin = smoothstep(0.04, 0.16, alb.r - alb.b) * smoothstep(0.25, 0.5, lum);
          float dark = 1.0 - smoothstep(0.015, 0.07, lum);                       // hair, skirt
          float nb = dot(normal, uBack), fres = pow(1.0 - saturate(dot(normal, V)), 3.0);
          float lit = 1.0, thin = 1.0;                                            // in the backlight / less than a few cm of body between here and the light
          #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
            DirectionalLightShadow ds = directionalLightShadows[0];
            lit = getShadow(directionalShadowMap[0], ds.shadowMapSize, ds.shadowIntensity, ds.shadowBias, ds.shadowRadius, vDirectionalShadowCoord[0]);
            thin = getShadow(directionalShadowMap[0], ds.shadowMapSize, ds.shadowIntensity, ds.shadowBias - 0.006, ds.shadowRadius * 2.0, vDirectionalShadowCoord[0]);
          #endif
          // rim: grazing surfaces that also face the backlight
          outgoingLight += uKeyCol * uRim * fres * lit * smoothstep(-0.25, 0.6, nb) * (0.3 + 0.9 * skin + 0.45 * dark) * (0.25 + 0.75 * lum + 0.35 * dark);
          // light bleeding round the terminator of skin, reddened
          float wrap = saturate((nb + 0.55) / 1.55) - saturate(nb);
          outgoingLight += skin * alb * vec3(1.0, 0.42, 0.3) * uKeyCol * wrap * uSSS * thin;
          // thin dark strands seen against the light let some of it through
          outgoingLight += dark * vec3(0.55, 0.3, 0.16) * uKeyCol * pow(saturate(dot(-V, uBack)), 3.0) * fres * 0.6 * thin;
          // eyes
          float eyeD = min(distance(vObj, uEyeR), distance(vObj, uEyeL));
          float eye = (1.0 - smoothstep(uEyeRad * 0.6, uEyeRad, eyeD)) * (1.0 - smoothstep(0.03, 0.1, alb.r - alb.b)) * smoothstep(0.12, 0.3, lum);
          outgoingLight += eye * (alb * 0.06 + uGlow * mix(vec3(0.05, 0.25, 0.9), vec3(0.25, 0.75, 1.7), smoothstep(0.3, 0.9, lum)));
        }
        #include <opaque_fragment>`);
    };
    m.needsUpdate = true;
  }

  // ---- bloom
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt), bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), num('bloom', 0.3), 0.55, 1.0);
  composer.addPass(new RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(new OutputPass());

  const state = { look: true, glow: false, spark: true };
  let glow = 0, sparkL = 0, last = 0;
  const back = new THREE.Vector3();
  function set(o) {
    Object.assign(state, o);
    rig.visible = state.look; flat.visible = !state.look; U.uOn.value = state.look ? 1 : 0;
    scene.background = state.look ? BG_FINAL : BG_FLAT;
    renderer.toneMapping = state.look ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping; renderer.toneMappingExposure = num('exp', 1.0);
  }
  function render(t) {                                           // t undefined or 0: settled, no flicker
    const dt = t ? Math.min(0.1, Math.max(0, t - last)) : 1; last = t || 0;
    glow += ((state.glow ? 1 : 0) - glow) * Math.min(1, dt * 5);
    sparkL += ((state.spark ? 1 : 0) - sparkL) * Math.min(1, dt * 8);
    const flick = t ? 0.8 + 0.2 * Math.sin(t * 31) * Math.sin(t * 17.3) : 1;
    U.uGlow.value = glow * (t ? 0.9 + 0.1 * Math.sin(t * 5) : 1); spark.intensity = sparkL * flick * num('sp', 0.6);
    back.copy(key.position).sub(key.target.position).normalize().transformDirection(camera.matrixWorldInverse); U.uBack.value.copy(back);
    if (state.look) composer.render(); else renderer.render(scene, camera);
  }
  function resize(w, h) { const r = renderer.getPixelRatio(); composer.setPixelRatio(r); composer.setSize(w, h); }
  set({});
  return { sun: key, dress, set, render, resize, key, sky, fill, spark, bloom, U };
}
