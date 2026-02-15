"use client";

import { useEffect, useRef } from "react";

// OGL types
interface OGLRenderer {
    gl: WebGLRenderingContext;
    setSize: (w: number, h: number) => void;
}

interface OGLGeometry {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new(gl: WebGLRenderingContext, options: Record<string, any>): any;
}

interface OGLProgram {
    new(
        gl: WebGLRenderingContext,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options: Record<string, any>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any;
}

interface OGLMesh {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new(gl: WebGLRenderingContext, options: Record<string, any>): any;
}

const vertexShader = `
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uHueShift;
  uniform float uNoiseIntensity;
  uniform float uScanlineIntensity;
  uniform float uSpeed;
  uniform float uWarpAmount;
  
  varying vec2 vUv;
  
  // Simplex-like noise
  vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    
    vec4 x2_ = x_ * ns.x + ns.yyyy;
    vec4 y2_ = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x2_) - abs(y2_);
    
    vec4 b0 = vec4(x2_.xy, y2_.xy);
    vec4 b1 = vec4(x2_.zw, y2_.zw);
    
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  
  vec3 hsl2rgb(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
  }
  
  void main() {
    vec2 uv = vUv;
    float t = uTime * uSpeed;
    
    // Warp UV
    float warpX = snoise(vec3(uv * 2.0, t * 0.3)) * uWarpAmount;
    float warpY = snoise(vec3(uv * 2.0 + 100.0, t * 0.3)) * uWarpAmount;
    vec2 warpedUv = uv + vec2(warpX, warpY);
    
    // Layered noise
    float n1 = snoise(vec3(warpedUv * 3.0, t * 0.2));
    float n2 = snoise(vec3(warpedUv * 6.0 + 50.0, t * 0.15)) * 0.5;
    float n3 = snoise(vec3(warpedUv * 12.0 + 100.0, t * 0.1)) * 0.25;
    float noise = (n1 + n2 + n3) * uNoiseIntensity;
    
    // Color
    float hue = uHueShift + noise * 0.1;
    float saturation = 0.6 + noise * 0.2;
    float lightness = 0.05 + noise * 0.08;
    
    vec3 color = hsl2rgb(hue, saturation, lightness);
    
    // Scanlines
    float scanline = sin(uv.y * uResolution.y * 1.5) * 0.5 + 0.5;
    scanline = pow(scanline, 8.0) * uScanlineIntensity;
    color -= scanline;
    
    // Edge vignette
    vec2 vigUv = uv * 2.0 - 1.0;
    float vig = 1.0 - dot(vigUv * 0.5, vigUv * 0.5);
    vig = smoothstep(0.0, 0.7, vig);
    color *= vig;
    
    gl_FragColor = vec4(max(color, vec3(0.02, 0.02, 0.03)), 1.0);
  }
`;

interface DarkVeilProps {
    className?: string;
    hueShift?: number;
    noiseIntensity?: number;
    scanlineIntensity?: number;
    speed?: number;
    warpAmount?: number;
}

export function DarkVeil({
    className = "",
    hueShift = 0.75,
    noiseIntensity = 0.8,
    scanlineIntensity = 0.03,
    speed = 0.15,
    warpAmount = 0.15,
}: DarkVeilProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const animationRef = useRef<number>(0);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let renderer: OGLRenderer | null = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let mesh: any = null;
        let startTime = Date.now();

        const init = async () => {
            try {
                const OGL = await import("ogl");
                const RendererClass = OGL.Renderer as unknown as new (
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    options: Record<string, any>
                ) => OGLRenderer;

                renderer = new RendererClass({
                    alpha: false,
                    antialias: false,
                    dpr: Math.min(window.devicePixelRatio, 1.5),
                });

                const gl = renderer.gl;
                const canvas = gl.canvas as HTMLCanvasElement;
                container.appendChild(canvas);
                canvas.style.width = "100%";
                canvas.style.height = "100%";

                const GeometryClass = OGL.Plane as unknown as OGLGeometry;
                const ProgramClass = OGL.Program as unknown as OGLProgram;
                const MeshClass = OGL.Mesh as unknown as OGLMesh;

                const geometry = new GeometryClass(gl, { width: 2, height: 2 });
                const program = new ProgramClass(gl, {
                    vertex: vertexShader,
                    fragment: fragmentShader,
                    uniforms: {
                        uTime: { value: 0 },
                        uResolution: { value: [gl.canvas.width, gl.canvas.height] },
                        uHueShift: { value: hueShift },
                        uNoiseIntensity: { value: noiseIntensity },
                        uScanlineIntensity: { value: scanlineIntensity },
                        uSpeed: { value: speed },
                        uWarpAmount: { value: warpAmount },
                    },
                });

                mesh = new MeshClass(gl, { geometry, program });

                const resize = () => {
                    if (!renderer || !container) return;
                    const w = container.clientWidth;
                    const h = container.clientHeight;
                    renderer.setSize(w, h);
                    if (mesh?.program?.uniforms?.uResolution) {
                        mesh.program.uniforms.uResolution.value = [w, h];
                    }
                };

                window.addEventListener("resize", resize, { passive: true });
                resize();

                startTime = Date.now();
                let isHidden = false;

                const handleVisibility = () => {
                    isHidden = document.hidden;
                };
                document.addEventListener("visibilitychange", handleVisibility);

                const animate = () => {
                    animationRef.current = requestAnimationFrame(animate);
                    if (isHidden || !renderer || !mesh) return;

                    const elapsed = (Date.now() - startTime) / 1000;
                    mesh.program.uniforms.uTime.value = elapsed;

                    renderer.gl.viewport(
                        0,
                        0,
                        renderer.gl.canvas.width,
                        renderer.gl.canvas.height
                    );
                    mesh.program.use();
                    mesh.geometry.draw({ mode: renderer.gl.TRIANGLES, program: mesh.program });
                };

                animate();

                return () => {
                    window.removeEventListener("resize", resize);
                    document.removeEventListener("visibilitychange", handleVisibility);
                };
            } catch (error) {
                console.warn("DarkVeil: WebGL initialization failed", error);
            }
        };

        const cleanup = init();

        return () => {
            cancelAnimationFrame(animationRef.current);
            cleanup?.then((fn) => fn?.());
            if (renderer && container) {
                const canvas = container.querySelector("canvas");
                if (canvas) container.removeChild(canvas);
            }
        };
    }, [hueShift, noiseIntensity, scanlineIntensity, speed, warpAmount]);

    return (
        <div
            ref={containerRef}
            className={`fixed inset-0 -z-10 ${className}`}
            style={{ pointerEvents: "none" }}
            aria-hidden="true"
        />
    );
}

export default DarkVeil;
