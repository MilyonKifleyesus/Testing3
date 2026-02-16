import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { register as registerSwiperElements } from 'swiper/element';

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
