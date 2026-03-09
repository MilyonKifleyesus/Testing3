import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { CaptureWorkflowApi, waitForRouteThenCapture } from './capture.workflow';

describe('waitForRouteThenCapture', () => {
  it('captures once when the target route becomes ready', fakeAsync(() => {
    let loading = true;
    let routes: any[] = [
      {
        projectId: 'p1',
        fromCoordinates: { latitude: 1, longitude: 2 },
        toCoordinates: { latitude: NaN, longitude: 0 },
      },
    ];

    const api: CaptureWorkflowApi = {
      captureAndStoreForProject: jasmine.createSpy('captureAndStoreForProject').and.returnValue(Promise.resolve()),
      projectRoutesLoading: jasmine.createSpy('projectRoutesLoading').and.callFake(() => loading),
      projectRoutes: jasmine.createSpy('projectRoutes').and.callFake(() => routes as any),
    };

    const onExhausted = jasmine.createSpy('onExhausted');
    const cancel = waitForRouteThenCapture(api, 'p1', 'Project One', 0, 100, 5, onExhausted);

    tick(0); // first attempt: still loading + route not ready
    expect(api.captureAndStoreForProject).not.toHaveBeenCalled();

    loading = false;
    routes = [
      {
        projectId: 'p1',
        fromCoordinates: { latitude: 10, longitude: 20 },
        toCoordinates: { latitude: 30, longitude: 40 },
      },
    ];

    tick(100); // second attempt: ready
    expect(api.captureAndStoreForProject).toHaveBeenCalledTimes(1);
    expect(api.captureAndStoreForProject).toHaveBeenCalledWith('p1', 'Project One');
    expect(onExhausted).not.toHaveBeenCalled();

    cancel();
    tick(1000);
    expect(api.captureAndStoreForProject).toHaveBeenCalledTimes(1);
  }));

  it('calls onExhausted when the route never becomes ready', fakeAsync(() => {
    const api: CaptureWorkflowApi = {
      captureAndStoreForProject: jasmine.createSpy('captureAndStoreForProject').and.returnValue(Promise.resolve()),
      projectRoutesLoading: jasmine.createSpy('projectRoutesLoading').and.returnValue(false),
      projectRoutes: jasmine.createSpy('projectRoutes').and.returnValue([]),
    };

    const onExhausted = jasmine.createSpy('onExhausted');
    waitForRouteThenCapture(api, 'p1', undefined, 0, 10, 3, onExhausted);

    tick(0);
    tick(10);
    tick(10);

    expect(api.captureAndStoreForProject).not.toHaveBeenCalled();
    expect(onExhausted).toHaveBeenCalledTimes(1);
  }));

  it('cancels pending timers and prevents capture/exhaustion', fakeAsync(() => {
    const api: CaptureWorkflowApi = {
      captureAndStoreForProject: jasmine.createSpy('captureAndStoreForProject').and.returnValue(Promise.resolve()),
      projectRoutesLoading: jasmine.createSpy('projectRoutesLoading').and.returnValue(false),
      projectRoutes: jasmine.createSpy('projectRoutes').and.returnValue([]),
    };

    const onExhausted = jasmine.createSpy('onExhausted');
    const cancel = waitForRouteThenCapture(api, 'p1', undefined, 50, 10, 3, onExhausted);
    cancel();

    tick(1000);
    expect(api.captureAndStoreForProject).not.toHaveBeenCalled();
    expect(onExhausted).not.toHaveBeenCalled();
  }));

  it('invokes onCaptureError when captureAndStoreForProject rejects', fakeAsync(() => {
    spyOn(console, 'error').and.stub();

    const api: CaptureWorkflowApi = {
      captureAndStoreForProject: jasmine
        .createSpy('captureAndStoreForProject')
        .and.callFake(() => Promise.reject(new Error('fail'))),
      projectRoutesLoading: jasmine.createSpy('projectRoutesLoading').and.returnValue(false),
      projectRoutes: jasmine.createSpy('projectRoutes').and.returnValue([
        {
          projectId: 'p1',
          fromCoordinates: { latitude: 10, longitude: 20 },
          toCoordinates: { latitude: 30, longitude: 40 },
        },
      ] as any),
    };

    const onExhausted = jasmine.createSpy('onExhausted');
    const onCaptureError = jasmine.createSpy('onCaptureError');
    waitForRouteThenCapture(api, 'p1', 'Project One', 0, 10, 2, onExhausted, onCaptureError);

    tick(0);
    flushMicrotasks();

    expect(api.captureAndStoreForProject).toHaveBeenCalledTimes(1);
    expect(onCaptureError).toHaveBeenCalledTimes(1);
    expect(onExhausted).not.toHaveBeenCalled();
  }));
});
