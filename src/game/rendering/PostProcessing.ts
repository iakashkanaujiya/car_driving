import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Filmic grade applied in linear HDR before tone mapping. */
const GradeShader = {
  name: 'DriftlineGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 1.08 },
    vignette: { value: 0.42 },
    warmth: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float vignette;
    uniform vec3 warmth;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D( tDiffuse, vUv );
      float luminance = dot( color.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
      color.rgb = mix( vec3( luminance ), color.rgb, saturation ) * warmth;
      vec2 offset = vUv - 0.5;
      color.rgb *= 1.0 - dot( offset, offset ) * vignette;
      gl_FragColor = color;
    }
  `,
};

/**
 * HDR pipeline for medium/high quality: MSAA scene render, bloom on emissive
 * lights and the sun, a light filmic grade, then tone mapping in OutputPass.
 */
export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    renderer.getDrawingBufferSize(this.size);
    const target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(this.size.clone(), 0.32, 0.6, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(GradeShader));
    this.composer.addPass(new OutputPass());
  }

  /** Mirrors the viewport size and the renderer's pixel ratio onto every pass target. */
  syncSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(Math.max(1, width), Math.max(1, height));
  }

  render(deltaSeconds: number): void {
    this.composer.render(deltaSeconds);
  }

  dispose(): void {
    this.bloom.dispose();
    this.composer.dispose();
  }
}
