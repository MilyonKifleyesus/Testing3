import { ComponentFixture, TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { WarRoomComponent } from './war-room.component';
import { WarRoomMapComponent } from './components/war-room-map/war-room-map.component';
import { WarRoomService } from '../../../shared/services/war-room.service';
import { WarRoomRealtimeService } from '../../../shared/services/war-room-realtime.service';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { CompanyFormData } from './components/add-company-modal/add-company-modal.component';

describe('WarRoomComponent Integration', () => {
    let component: WarRoomComponent;
    let fixture: ComponentFixture<WarRoomComponent>;
    let warRoomService: WarRoomService;

    const realtimeServiceMock = {
        startRealTimeUpdates: jasmine.createSpy('startRealTimeUpdates'),
        stopRealTimeUpdates: jasmine.createSpy('stopRealTimeUpdates'),
    };

    beforeEach(async () => {
        spyOn(WarRoomMapComponent.prototype as any, 'loadScripts').and.returnValue(Promise.resolve());
        spyOn(WarRoomMapComponent.prototype as any, 'initializeMap').and.stub();
        spyOn(WarRoomMapComponent.prototype as any, 'zoomToEntity').and.stub();

        // Mock fetch ONLY for initial data load (which happens in constructor)
        spyOn(window, 'fetch').and.callFake(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.includes('war-room-data.json')) {
                return new Response(JSON.stringify({
                    parentGroups: [],
                    nodes: [],
                    mapViewMode: 'parent'
                }), { status: 200 });
            }
            return new Response('{}', { status: 404 });
        });

        await TestBed.configureTestingModule({
            imports: [WarRoomComponent, BrowserAnimationsModule],
            providers: [
                WarRoomService,
                { provide: WarRoomRealtimeService, useValue: realtimeServiceMock },
                provideHttpClient(),
                provideHttpClientTesting()
            ]
        })
            .compileComponents();

        fixture = TestBed.createComponent(WarRoomComponent);
        component = fixture.componentInstance;
        warRoomService = TestBed.inject(WarRoomService);

        // Spy on parseLocationInput to avoid external calls and async issues
        spyOn(warRoomService, 'parseLocationInput').and.callFake(async (location) => {
            if (location.includes('Los Angeles')) {
                return { latitude: 34.0522, longitude: -118.2437 };
            }
            return { latitude: 40.7128, longitude: -74.0060 }; // Default NY
        });

        fixture.detectChanges();
        await fixture.whenStable();
    });

    it('should verify sub-location entries appear on the map', fakeAsync(() => {
        const testCompanyData: CompanyFormData = {
            companyName: 'Integration Test Corp',
            location: 'New York, USA',
            description: 'Test Description',
            subLocations: [
                {
                    name: 'LA Branch',
                    location: 'Los Angeles, USA',
                    status: 'ACTIVE'
                }
            ]
        };

        let done = false;
        component.onCompanyAdded(testCompanyData).then(() => {
            done = true;
        });

        // Flush microtasks (signatures of parseLocationInput mock are async)
        flush();
        tick(100);
        fixture.detectChanges();

        expect(done).toBeTrue();

        const subsidiaries = component.subsidiaries();
        const newSub = subsidiaries.find(s => s.name === 'INTEGRATION TEST CORP');
        expect(newSub).toBeTruthy('Subsidiary should be created');

        if (newSub) {
            expect(newSub.factories.length).toBe(2, 'Should have 2 factories (Main + Sub)');

            const mainFactory = newSub.factories.find(f => f.city.includes('New York'));
            const subFactory = newSub.factories.find(f => f.name.includes('LA Branch'));

            expect(mainFactory).toBeTruthy('Main factory should exist');
            expect(subFactory).toBeTruthy('Sub-location factory should exist');

            expect(mainFactory!.coordinates.latitude).toBeCloseTo(40.7128, 1);

            expect(subFactory!.coordinates.latitude).toBeCloseTo(34.0522, 1);
        }
    }));
});
