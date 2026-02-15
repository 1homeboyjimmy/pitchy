import { useEffect, useRef } from 'react';
import { Renderer, Program, Mesh, Triangle } from 'ogl';

interface DarkVeilProps {
  hueShift?: number;
  noiseIntensity?: number;
  scanlineIntensity?: number;
  speed?: number;
  warpAmount?: number;
  resolutionScale?: number;
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
  
  // Simplex noise function
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
  
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                           + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                            dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  
  // HSL to RGB conversion
  vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }
  
  void main() {
    vec2 uv = vUv;
    vec2 center = vec2(0.5, 0.5);
    
    // Warp effect
    float dist = distance(uv, center);
    float warp = uWarpAmount * sin(dist * 3.14159 + uTime * uSpeed * 0.5);
    uv += (uv - center) * warp * 0.1;
    
    // Create flowing noise pattern
    float time = uTime * uSpeed;
    
    float noise1 = snoise(uv * 2.0 + time * 0.1);
    float noise2 = snoise(uv * 4.0 - time * 0.15 + 100.0);
    float noise3 = snoise(uv * 1.5 + time * 0.08 + 200.0);
    
    float combinedNoise = (noise1 + noise2 * 0.5 + noise3 * 0.25) / 1.75;
    
    // Base color - deep purple/violet
    float hue = 0.75 + uHueShift + combinedNoise * 0.05;
    float saturation = 0.4 + combinedNoise * 0.2;
    float lightness = 0.04 + combinedNoise * uNoiseIntensity * 0.5;
    
    vec3 color = hsl2rgb(vec3(hue, saturation, lightness));
    
    // Add subtle vignette
    float vignette = 1.0 - dist * 0.4;
    color *= vignette;
    
    // Scanlines (very subtle)
    if (uScanlineIntensity > 0.0) {
      float scanline = sin(uv.y * uResolution.y * 0.5) * 0.5 + 0.5;
      color *= 1.0 - (1.0 - scanline) * uScanlineIntensity * 0.1;
    }
    
    // Add subtle glow in center
    float centerGlow = 1.0 - smoothstep(0.0, 0.6, dist);
    vec3 glowColor = hsl2rgb(vec3(0.75 + uHueShift, 0.5, 0.08));
    color += glowColor * centerGlow * 0.15;
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function DarkVeil({
  hueShift = 0,
  noiseIntensity = 0.02,
  scanlineIntensity = 0,
  speed = 0.4,
  warpAmount = 0.15,
  resolutionScale = 1,
}: DarkVeilProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const animationRef = useRef<number>(0);
  const isActiveRef = useRef(true);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const dpr = Math.min(window.devicePixelRatio, 2);
    
    // Create renderer
    const renderer = new Renderer({
      dpr: dpr * resolutionScale,
      alpha: false,
      antialias: false,
    });
    rendererRef.current = renderer;
    
    const gl = renderer.gl;
    gl.clearColor(0.04, 0.04, 0.06, 1.0);
    container.appendChild(gl.canvas);
    gl.canvas.style.position = 'absolute';
    gl.canvas.style.top = '0';
    gl.canvas.style.left = '0';
    gl.canvas.style.width = '100%';
    gl.canvas.style.height = '100%';
    gl.canvas.style.zIndex = '-1';

    // Create geometry (full-screen triangle)
    const geometry = new Triangle(gl);

    // Create program
    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [container.clientWidth, container.clientHeight] },
        uHueShift: { value: hueShift },
        uNoiseIntensity: { value: noiseIntensity },
        uScanlineIntensity: { value: scanlineIntensity },
        uSpeed: { value: speed },
        uWarpAmount: { value: warpAmount },
      },
    });

    // Create mesh
    const mesh = new Mesh(gl, { geometry, program });
    meshRef.current = mesh;

    // Handle resize
    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
      program.uniforms.uResolution.value = [width, height];
    };
    
    handleResize();
    window.addEventListener('resize', handleResize, { passive: true });

    // Animation loop with visibility check
    let lastTime = performance.now();
    const targetFPS = 30;
    const frameInterval = 1000 / targetFPS;
    
    const animate = (currentTime: number) => {
      if (!isActiveRef.current) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }
      
      const deltaTime = currentTime - lastTime;
      
      if (deltaTime >= frameInterval) {
        lastTime = currentTime - (deltaTime % frameInterval);
        
        if (meshRef.current && rendererRef.current) {
          const timeInSeconds = currentTime * 0.001;
          meshRef.current.program.uniforms.uTime.value = timeInSeconds;
          rendererRef.current.render({ scene: meshRef.current });
        }
      }
      
      animationRef.current = requestAnimationFrame(animate);
    };

    // Visibility API to pause when tab is hidden
    const handleVisibilityChange = () => {
      isActiveRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      isActiveRef.current = false;
      cancelAnimationFrame(animationRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', handleResize);
      
      if (rendererRef.current) {
        const canvas = rendererRef.current.gl.canvas;
        canvas.remove();
        rendererRef.current = null;
      }
    };
  }, [hueShift, noiseIntensity, scanlineIntensity, speed, warpAmount, resolutionScale]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 -z-10"
      style={{
        background: 'linear-gradient(180deg, #0A0A0F 0%, #0D0D14 50%, #0A0A0F 100%)',
      }}
    >
      {/* Overlay gradient for better content readability */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(139, 92, 246, 0.08) 0%, transparent 50%)',
        }}
      />
    </div>
  );
}

export default DarkVeil;
