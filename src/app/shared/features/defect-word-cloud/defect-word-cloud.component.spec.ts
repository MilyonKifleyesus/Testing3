import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DefectWordCloudComponent } from './defect-word-cloud.component';
import { DefectWordCloudService } from './defect-word-cloud.service';
import { AggregatedWordCloudResult } from './defect-word-cloud.models';

describe('DefectWordCloudComponent', () => {
  let fixture: ComponentFixture<DefectWordCloudComponent>;
  let component: DefectWordCloudComponent;
  let serviceMock: jasmine.SpyObj<DefectWordCloudService>;

  const sampleResult: AggregatedWordCloudResult = {
    words: [
      { key: 'engine fire wire is loose.', text: 'Engine fire wire is loose.', value: 4 },
      { key: 'protect a/c lines better', text: 'Protect a/c lines better', value: 2 },
    ],
    totalTickets: 12,
    validDescriptionCount: 10,
    uniqueDescriptionCount: 2,
  };

  beforeEach(async () => {
    serviceMock = jasmine.createSpyObj<DefectWordCloudService>('DefectWordCloudService', [
      'getWordCloudData',
      'getInspectionAreaOptions',
      'createBackendSignature',
      'toUserMessage',
    ]);

    serviceMock.getWordCloudData.and.returnValue(of(sampleResult));
    serviceMock.getInspectionAreaOptions.and.returnValue(of([
      { id: '4', name: 'Driver’s Area' },
      { id: '9', name: 'Vehicle Understructure' },
    ]));
    serviceMock.createBackendSignature.and.callFake((filters) => JSON.stringify(filters));
    serviceMock.toUserMessage.and.returnValue('Request failed (500).');

    spyOn(window, 'requestAnimationFrame').and.callFake((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    (window as any).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };

    await TestBed.configureTestingModule({
      imports: [DefectWordCloudComponent],
      providers: [
        { provide: DefectWordCloudService, useValue: serviceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DefectWordCloudComponent);
    component = fixture.componentInstance;
  });

  it('renders the Inspection Area label and loads the initial data', fakeAsync(() => {
    fixture.detectChanges();
    tick(250);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Inspection Area');
    expect(fixture.nativeElement.textContent).toContain('12 tickets');
    expect(serviceMock.getWordCloudData).toHaveBeenCalledTimes(1);
  }));

  it('shows a retry action after an API error and retries successfully', fakeAsync(() => {
    serviceMock.getWordCloudData.and.returnValues(
      throwError(() => new Error('boom')),
      of(sampleResult),
    );

    fixture.detectChanges();
    tick(250);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Unable to load defect data');

    const retryButton = fixture.nativeElement.querySelector('.error-state button') as HTMLButtonElement;
    retryButton.click();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    expect(serviceMock.getWordCloudData).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('12 tickets');
  }));

  it('does not refetch when only the local defect filter changes', fakeAsync(() => {
    fixture.detectChanges();
    tick(250);
    fixture.detectChanges();

    component.onSelectedDefectChange('engine fire wire is loose.');
    fixture.detectChanges();
    tick(300);
    fixture.detectChanges();

    expect(serviceMock.getWordCloudData).toHaveBeenCalledTimes(1);
    expect(component.filteredWords().length).toBe(1);
  }));

  it('blocks refetch when the date range is invalid', fakeAsync(() => {
    fixture.detectChanges();
    tick(250);
    fixture.detectChanges();

    component.onDateFromChange('2024-04-10');
    component.onDateToChange('2024-04-01');
    fixture.detectChanges();
    tick(250);
    fixture.detectChanges();

    expect(serviceMock.getWordCloudData).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Date From must be on or before Date To.');
  }));

  it('keeps inspection area options stable while other filters change', fakeAsync(() => {
    fixture.detectChanges();
    tick(250);
    fixture.detectChanges();

    component.onVehicleIdChange('541');
    component.onDateFromChange('2024-04-01');
    fixture.detectChanges();
    tick(250);
    fixture.detectChanges();

    expect(serviceMock.getInspectionAreaOptions).toHaveBeenCalledTimes(1);
    expect(component.inspectionAreaOptions().map((option) => option.name)).toEqual([
      'Driver’s Area',
      'Vehicle Understructure',
    ]);
  }));

  it('resizes the chart when fullscreen mode changes', fakeAsync(() => {
    fixture.detectChanges();
    tick(250);
    fixture.detectChanges();

    const chartInstance = jasmine.createSpyObj('ECharts', ['resize', 'dispose']);
    component.onChartInit(chartInstance);

    component.fullscreen = true;
    tick();

    expect(chartInstance.resize).toHaveBeenCalled();
  }));
});
