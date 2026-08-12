// Tailwind CSS 4 se integra vía plugin de PostCSS; la configuración de diseño vive en
// src/app/globals.css con la directiva @theme (ya no existe tailwind.config.js).
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
