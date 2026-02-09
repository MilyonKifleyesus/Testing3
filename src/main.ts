import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { register as registerSwiperElements } from 'swiper/element';

registerSwiperElements();

// Prevent SVG path "d" scientific notation (e.g. 1e-16) which some parsers reject (e.g. ApexCharts)
function sanitizePathD(value: string): string {
  return value.replace(/\d+e[-+]?\d+/gi, (match) => {
    const num = parseFloat(match);
    if (!Number.isFinite(num)) return match;
    const s = String(num);
    if (s.includes('e') || s.includes('E')) {
      const fixed = num.toFixed(20);
      return fixed.replace(/\.?0+$/, '') || '0';
    }
    return s;
  });
}
const originalSetAttribute = SVGElement.prototype.setAttribute;
SVGElement.prototype.setAttribute = function (name: string, value: string | number | boolean) {
  if (name === 'd' && typeof value === 'string' && (value.includes('e') || value.includes('E'))) {
    value = sanitizePathD(value);
  }
  return originalSetAttribute.call(this, name, value as string);
};

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
