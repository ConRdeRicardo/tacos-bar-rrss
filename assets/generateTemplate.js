import fs from 'fs';
import path from 'path';

// Generar una plantilla SVG de 1080x1920 transparente con acentos visuales para discoteca
const templateSvg = `
<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Gradiente superior sutil para resaltar texto de fecha y perfil -->
    <linearGradient id="topVignette" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.65"/>
      <stop offset="30%" stop-color="#000000" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>

    <!-- Gradiente inferior sutil para safe-zone de Instagram -->
    <linearGradient id="bottomVignette" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="70%" stop-color="#000000" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.75"/>
    </linearGradient>

    <!-- Filtro de sombra neón para marca de discoteca -->
    <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>

  <!-- Viñeta superior -->
  <rect x="0" y="0" width="1080" height="420" fill="url(#topVignette)" />

  <!-- Viñeta inferior -->
  <rect x="0" y="1500" width="1080" height="420" fill="url(#bottomVignette)" />

  <!-- Marco estético sutil interior -->
  <rect x="30" y="30" width="1020" height="1860" rx="20" fill="none" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="2" />

  <!-- Marca de agua / Branding inferior Tacos Bar / Discoteca -->
  <g filter="url(#neonGlow)">
    <text 
      x="540" 
      y="1820" 
      text-anchor="middle" 
      font-family="'DejaVu Sans', 'Liberation Sans', Arial, Helvetica, sans-serif" 
      font-size="28" 
      font-weight="800" 
      fill="#FFFFFF" 
      fill-opacity="0.85" 
      letter-spacing="8"
    >TACOS BAR • NIGHTCLUB</text>
  </g>
</svg>
`.trim();

const targetPath = path.resolve('./assets/template_story.svg');
fs.writeFileSync(targetPath, templateSvg, 'utf-8');
console.log('Template SVG generado exitosamente en:', targetPath);
