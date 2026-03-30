import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { register as registerSwiperElements } from 'swiper/element';

// Suppress Angular 19 deprecation warning for allowSignalWrites until Angular stops passing it internally.
// Our code does not pass allowSignalWrites to effect(); the warning is from the framework's component-effect path.
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : String(args[0]);
  if (msg.includes("allowSignalWrites") && msg.includes("deprecated")) {
    return;
  }
  originalWarn.apply(console, args);
};

const configureApexGlobalOptions = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const scopedWindow = window as typeof window & { Apex?: any };
  const currentApex = scopedWindow.Apex ?? {};
  const currentChart = currentApex.chart ?? {};
  const currentToolbar = currentChart.toolbar ?? {};
  const currentTools = currentToolbar.tools ?? {};

  // Disable ApexCharts gesture handlers that trigger passive listener warnings.
  scopedWindow.Apex = {
    ...currentApex,
    chart: {
      ...currentChart,
      zoom: { ...currentChart.zoom, enabled: false },
      toolbar: {
        ...currentToolbar,
        tools: {
          ...currentTools,
          download: currentTools.download ?? true,
          selection: false,
          zoom: false,
          zoomin: false,
          zoomout: false,
          pan: false,
          reset: currentTools.reset ?? true,
        },
      },
    },
  };
};

configureApexGlobalOptions();
registerSwiperElements();
bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
