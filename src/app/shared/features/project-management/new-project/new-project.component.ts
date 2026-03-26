
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { resolveProjectManagementContext } from '../project-management-context';
import { ClientService } from '../../../services/client.service';
import { Client } from '../../../models/client.model';
import { LocationService, ApiLocation } from '../../../services/location.service';
import { UserManagementService, ManufacturerOption } from '../../../services/user-management.service';

// Define interfaces outside the class
interface InspectionCategory {
  id: number;
  name: string;
  selected: boolean;
}

interface InspectionTaskGroup {
  heading: string;
  tasks: { name: string; selected: boolean }[];
}

@Component({
  selector: 'app-new-project',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, FormsModule],
  templateUrl: './new-project.component.html',
  styleUrls: ['./new-project.component.scss']
})
export class NewProjectComponent implements OnInit {
    hasBuild = false;
  projectForm!: FormGroup;
  submitted = false;

  clients: Client[] = [];
  locations: ApiLocation[] = [];
  manufacturers: ManufacturerOption[] = [];

  inspectionCategories: InspectionCategory[] = [];

  // Inspection Tasks groups (must be inside the class)
  inspectionTaskGroups: InspectionTaskGroup[] = [
    {
        "heading": "LE65 - Driver\u2019s Area",
        "tasks": [
            {
                "name": "Check driver's area equipment for sharp edges, bump or pinch hazards etc.",
                "selected": false
            },
            {
                "name": "Check all interior trim panels for proper fit and finish (i.e. no gaps, bulges, sharp edges, protrusions, marks or abrasions).",
                "selected": false
            },
            {
                "name": "Check configuration, installation and operation of driver's area rear and side barrier panels, security barrier doors and latching mechanisms. Check configuration and installation of driver's area / entrance doorway stanchions and grabrails.",
                "selected": false
            },
            {
                "name": "Check for correct installation of driver's area rear and side barrier signage (i.e. rate of fare frame, no smoking, driver assault\u2026, fire extinguisher, TTC By- Law).",
                "selected": false
            },
            {
                "name": "Check for proper installation of black cloth with vinyl headrest Recaro Ergo M (AM384) Operator's air ride seat with 3-Point harness (i.e. max useable fore/aft, up/down and tilt travel without contacting surrounding panels or equipment, ELR Belt Retracton operation).",
                "selected": false
            },
            {
                "name": "Check operation of all seat controls and adjustments including headrest, backrest, fore/aft track, base cushion extension, air height, air lumbar and seat belt attachment (3-point harness - buckles on curb side).",
                "selected": false
            },
            {
                "name": "Check that Operator's seat switch arms the driver's distress alarm and sets off the park brake not applied alarm as intended with driver out of seat.",
                "selected": false
            },
            {
                "name": "Check Operator's side windows (smooth operation, rattle free, proper sealing and drainage, latches work properly, window stop adjusted for maximum window opening). Front section is equipped with an outside handle (window must open sufficiently from outside to allow door operation) and an inside handle/mechanism that prevents the window from closing on braking.",
                "selected": false
            },
            {
                "name": "Check steering wheel (VIP 20\u201d) and steering column configuration and installation. Check operation of tilt & telescopic functions. Check for excessive play or binding in steering system.",
                "selected": false
            },
            {
                "name": "Check windshield wipers and washers for proper operation (i.e. washer spray aimed correctly and smooth, streak free wiper operation). Ensure full (but not excessive) travel of wiper sweep. Check adjustable intermittent wiper operation and park position.",
                "selected": false
            },
            {
                "name": "Check brake & accelerator pedal set configuration, installation and operation (i.e. smooth action, no heel rest installed and pedals spaced and positioned in a manner that driver's foot will not contact surrounding trim or catch between pedals when shifting foot from one pedal to the other). Ensure no debris beneath pedals.",
                "selected": false
            },
            {
                "name": "Check heel operated high beam dimmer foot switch and toe operated turn signal foot switches for correct installation and operation.",
                "selected": false
            },
            {
                "name": "Check side consol mounted four-way flasher switch operation.",
                "selected": false
            },
            {
                "name": "Check that all panel illumination lighting works properly (i.e. aimed properly and dims with dash gauge lighting).",
                "selected": false
            },
            {
                "name": "Check dash, instrument panel, overhead console and side console controls, gauges and indicators for correct configuration and proper operation (i.e. arrangement per TTC approved drawing, telltale visual indicators and control identification text and graphics are legible - even with indicator light out and designed in a manner that won\u2019t scratch or wear off with normal use and cleaning, all telltale indicators illuminate and audible alarm sounds in test mode, all operate as intended for driver warnings,).",
                "selected": false
            },
            {
                "name": "Check instrument panel signage (i.e. arrangement per TTC approved drawing, plaques to identify air gauge pointers and bus height, decals stating bus is equipped with alarm, low air pressure, fire suppression system instructions, TTC Emergency numbers and notice to depress brake pedal prior to shifting out of neutral).",
                "selected": false
            },
            {
                "name": "Check installation, fit and operation of destination sign access door and dash area access doors.",
                "selected": false
            },
            {
                "name": "Check destination sign access door signage (i.e. TTC approved arrangement, fleet number, the operator\u2026, the law\u2026, please exit\u2026, in the interest\u2026 decals).",
                "selected": false
            },
            {
                "name": "Check speedometer/odometer for proper operation (i.e. push button diagnostic and info features on units or if equipped with separate diagnostic display, smooth and accurate needle movement, reads in kph with mph as secondary and odometer in kilometers).",
                "selected": false
            },
            {
                "name": "Check air gauge operation (i.e. smooth, accurate needle movement, reads in psi with kPa as secondary).",
                "selected": false
            },
            {
                "name": "Check diesel emission fluid (DEF) gauge operation (i.e. functions accurately).",
                "selected": false
            },
            {
                "name": "Check for installation of Kidde Dual Spectrum Fire Suppression control panel with status indicators, alarm silence and engine stop delay / system test button. Check for installation of a covered system activation switch button with identification plaque and system instruction decal.",
                "selected": false
            },
            {
                "name": "Check for proper installation of a 5lb, 3A, 40BC rated Amerex model #B402X fire extinguisher located behind the Operator's seat using the heavy-duty #860 dual rubber bungee mounting bracket.",
                "selected": false
            },
            {
                "name": "Check driver's heater, vent and windshield defrost system controls for correct operation and satisfactory performance in all modes. Verify control knobs properly secured.",
                "selected": false
            },
            {
                "name": "Check booster blower above driver's side window and aux. fan operation. (Both should have good air flow with high/low speeds and quiet operation.)",
                "selected": false
            },
            {
                "name": "Check installation of red guarded \u2018Depot Drive\u2019 switch above driver's side window along with indicator lamp.",
                "selected": false
            },
            {
                "name": "Check for proper installation of a red guarded \u201cDoor Master\u201d switch with seal bracket on forward surface of instrument panel housing \u2013 curb side. Test operation for warning alarm and to close entrance and exit doors and release interlocks. Test entrance and exit door sensitive edges and door obstruction recoil and alarms.",
                "selected": false
            },
            {
                "name": "Check for proper installation and operation of 5 position door controller (note that controller only authorizes rear doors \u2013 green light \u201con\u201d and chime sounds). Check \u201cExit Door Open\u201d switch.",
                "selected": false
            },
            {
                "name": "Check entrance door balance control for automatic operation on vehicle shutdown. Check operation of manual control provided on wall to left of driver's leg. Check exterior emergency release and reset valve inside access door below driver's side window.",
                "selected": false
            },
            {
                "name": "Check \u201cpush to apply\u201d park brake control with yellow knob for proper operation and no audible air leaks. Verify control knob properly secured with jam nut and Loc-tite.",
                "selected": false
            },
            {
                "name": "Check \u201dMaster Run Control\u201d rotary switch for proper operation (i.e. engine stop, day run, night run & park).",
                "selected": false
            },
            {
                "name": "Check engine start, fast idle and emergency override controls on side console for proper operation. (Note: Emergency override switch equipped with yellow guard.)",
                "selected": false
            },
            {
                "name": "Check shift control pad for proper operation. (Note: Selection of opposite direction while in motion results in forced neutral & disabled accelerator.)",
                "selected": false
            },
            {
                "name": "Check installation and operation of farebox lamp (on with front doors open) and driver's reading lamp. Both should function with engine off.",
                "selected": false
            },
            {
                "name": "Check operation of driver's distress alarm system. One switch to arm/disarm, another to activate alarm (intermittent horn blasts and exterior lights flash). With system armed and driver out of seat, pull on stop request chime cord or push stop request button shall also activate alarm.",
                "selected": false
            },
            {
                "name": "Check for installation of guarded \u201cSilent Alarm\u201d button. (Note this switch is inop until TTC's Vision system is commissioned & operational.)",
                "selected": false
            },
            {
                "name": "Check operation and orientation of exterior curb side mirror remote control.",
                "selected": false
            },
            {
                "name": "Check operation of timed mirror heat switch. Check exterior mirror lamps on steady with bus in operation, flash with signals.",
                "selected": false
            },
            {
                "name": "Check installation of red guarded \u201cRetarder Disable\u201d switch on side console with wire seal bracket. Check operation and verify that interior/exterior regen brake disable indicators are functional.",
                "selected": false
            },
            {
                "name": "Check Luminator Horizon SMT destination sign control pad for proper display and operation. Check control pad is properly installed and secured and equipped with flashcard port.",
                "selected": false
            },
            {
                "name": "Check operation and secure mounting of driver's front and side pull down sun blinds (i.e. ensure correct placement across top of driver's windshield and side window, sturdy mounting, blinds maintain set position without slippage). Verify rubber bumper installed to prevent contact with sliding glass.",
                "selected": false
            },
            {
                "name": "Check installation and operation of Transign hinged, two-digit run number sign (yellow characters on black backing) installed on top curb side corner of dash.",
                "selected": false
            },
            {
                "name": "Check for proper installation of placard holder on dash beside run number sign.",
                "selected": false
            },
            {
                "name": "Check installation and operation of 8 \u00bc\u201d x 16\u201d convex interior mirror over curbside corner of windshield area, 4\u201d x 16\u201d rectangular flat interior mirror center of windshield, 6\u201d diameter convex interior mirror on pillar behind entrance door and 12\u201d diameter convex interior mirror above and across from rear of exit doorway.",
                "selected": false
            },
            {
                "name": "Check for proper installation of \u2018TTC Vision\u2019 system Control Head for proper display and operation.",
                "selected": false
            },
            {
                "name": "Check, if equipped, for proper installation of Public WiFi module mounted behind ceiling mounted IT box.",
                "selected": false
            },
            {
                "name": "Check for proper installation of Transfer Cutter on top of Control Head Mount mounting bracket.",
                "selected": false
            },
            {
                "name": "Check for proper installation of TTC Vision Handset and Handset Cradle below Control Head Mount/Transfer Cutter location.",
                "selected": false
            },
            {
                "name": "Check for proper installation of TTC Vision \u2018Array\u2019 Microphone mounted below driver's overhead switches.",
                "selected": false
            },
            {
                "name": "Check configuration, fit and operation of interior compartment doors and locks (closed cell foam seals throughout). Check all compartments for accumulation of trash or manufacturing debris.",
                "selected": false
            },
            {
                "name": "Check storage compartments for proper configuration and supply of equipment (i.e. scooter belts/tethers in storage tub, Grote safety triangles in case, first aid kit etc.).",
                "selected": false
            },
            {
                "name": "Check inside of all interior compartments, and behind all access panels for proper harness, cable and hose securement and routing (i.e. no kinks, straining, chafing, proper application of tie-wraps, p-clamps etc.).",
                "selected": false
            },
            {
                "name": "Check for proper installation of Smart Yard Tag module mounted to the right of the driver's overhead access panel door.",
                "selected": false
            },
            {
                "name": "Check for proper installation of Passenger Counter system with cables routed from sensors at each door to unit mounted in overhead IT compartment behind driver's barrier (minimum 3ft. slack at each end) and wiring routed from power supply and odometer signal to counter unit.",
                "selected": false
            },
            {
                "name": "Check overhead IT compartment, behind driver's barrier, for proper installation of March Security Camera System \u201cRideSafe\u201d model NVR on slide out tray mounted to bracket attached to compartment ceiling.",
                "selected": false
            },
            {
                "name": "Check overhead IT compartment, behind driver's barrier, for proper installation of TTC Vision system including installation of wiring, radio module, IVN4 Controller, and associated devices.",
                "selected": false
            },
            {
                "name": "Check for installation of document pouch on barrier panel behind driver's seat.",
                "selected": false
            },
            {
                "name": "Check for installation of seat belt cutting tool on vertical surface below driver's side consol.",
                "selected": false
            },
            {
                "name": "Check for supply and proper configuration of farebox installation provisions (i.e. 3ft. coil of 12 volt continuous power and ground supply wiring \u2013 ends taped/capped and stainless steel farebox mounting bolts/nuts/washers and floor reinforcement plate).",
                "selected": false
            },
            {
                "name": "Mount dummy farebox (temporarily) to check all clearances (no interference with nearby equipment and adequate clearance for vault box installation/removal and hand/key-ring clearance for access to vault lock).",
                "selected": false
            },
            {
                "name": "Check installation of driver's cupholder on road side windshield pillar.",
                "selected": false
            },
            {
                "name": "Check installation of driver's coat hook on curb side of driver's barrier.",
                "selected": false
            },
            {
                "name": "Check installation of driver's area disposable trash bag mounting brackets.",
                "selected": false
            },
            {
                "name": "Check speedometer or diagnostic display for stored diagnostic trouble codes, report for repair and code cancellation.",
                "selected": false
            },
            {
                "name": "Check for installation of VIN plate on side window pillar (with clear plastic protective cover) and record number on Release Form and Cover Sheet.",
                "selected": false
            },
            {
                "name": "Check for proper installation of Ramp Hook and mounting Clips mounted behind driver's seat.",
                "selected": false
            }
        ]
    },
    {
        "heading": "LE65 - Wheelchair Ramp and Accessible Features",
        "tasks": [
            {
                "name": "Check wheelchair ramp for proper operation (manual and powered operation). Verify correct timing of ramp operating cycle and record on Road Test Data Sheet.",
                "selected": false
            },
            {
                "name": "Check deployed ramp non-slip surfaces for proper installation with yellow ramp edge nosing (nosing and non-slip materials secure and sealed as appropriate with no loose edges or catch hazards).",
                "selected": false
            },
            {
                "name": "Check stowed ramp yellow step nosing and non-slip vinyl platform surface for proper and secure installation. Check all yellow and stainless steel trim properly installed and secured.",
                "selected": false
            },
            {
                "name": "Check for proper installation of ramp sealing edge and floor cavity seals / brush (below side rails of stowed ramp).",
                "selected": false
            },
            {
                "name": "Check ramp for high visibility yellow/black side rail edging and fabric strap for manual operation.",
                "selected": false
            },
            {
                "name": "Check for quiet and proper operation of ramp / entrance floor heater & blower assembly.",
                "selected": false
            },
            {
                "name": "Check that all specified interlock functions are working properly (accelerator and brakes) and verify that the vehicle does not move with the ramp deployed, bus suspension knelt, entrance or exit doors open. (Note that once the interlock activating device has been returned to the \u201cready to drive\u201d position, the service brake must be depressed before pushing the accelerator to release the interlocks.)",
                "selected": false
            },
            {
                "name": "Check that ramp operation is prevented unless front doors are fully open.",
                "selected": false
            },
            {
                "name": "Check bus kneeling feature for proper operation (momentary action on lowering, full up to ride height when raising). Verify bus does not kneel with ramp deployed.",
                "selected": false
            },
            {
                "name": "Check operation of the ramp warning indicators (beeper and int./ ext. amber flashing lights while ramp is powered to deploy or stow and during bus kneeling). Check interior \u201cbus lowers\u201d warning decal on face of driver's platform and exterior \u201cbus kneels\u201d warning decal installed below exterior ramp/kneeling lamp.",
                "selected": false
            },
            {
                "name": "Check operation of interior/ exterior ADA lighting at both doors (LED strip lights overhead, hooded low level LED exterior light, front door lamps on with doors open, off with doors close, rear door lamps stay on for 5 seconds after doors close).",
                "selected": false
            },
            {
                "name": "Check for large W/C logos on exterior curb side front panel of bus (forward facing below windshield and adjacent to curb side wiper arm pivot), and on curb side of rear panel above engine compartment door (rear facing, above cooling louvers).",
                "selected": false
            },
            {
                "name": "Check for appropriate Priority Seating decals, on inside of passenger windows above folding bench seats and folding single seats on opposite side of aisle.",
                "selected": false
            },
            {
                "name": "Check wheelchair securements for correct configuration with retractor anti-rotation clips installed. Verify proper operation of restraint retractor mechanisms and remote release mechanisms.",
                "selected": false
            },
            {
                "name": "Check that 2 portable scooter belts / retractors and 4 tether straps (2 short & 2 long) supplied in metal compartment located atop of the curbside wheel well.",
                "selected": false
            },
            {
                "name": "Check for installation of securement system instruction plaques on underside of folding seats.",
                "selected": false
            },
            {
                "name": "Check under folding seats for proper installation and operation of yellow touch pad stop request switches (to activate dash and passenger area stop request signs and double chime stop request signal, operates once when activated and then must be reset by cycling of doors).",
                "selected": false
            },
            {
                "name": "Check for proper installation and operation of under seat lighting beneath each folding seat and under the folding \u201cPriority\u201d single seats. (Under seat lighting shall be switched on when the front door opens and off 5 seconds after the front door closes. There is also a switch in the driver's area to manually operate the lights.)",
                "selected": false
            },
            {
                "name": "Check installation and operation of high visibility yellow horizontal chime cords throughout side walls of bus and that yellow vertical chime cords are properly secured between the passenger windows at each Mobility Device location, the Priority Seating area and rear opposing seat area.(Cords activate the stop request signs and single chime stop request signal, operates once when activated and then must be reset by cycling of doors. Cords should have adequate slack and crimp fittings installed to prevent false activation.)",
                "selected": false
            },
            {
                "name": "Check installation and operation of stop request buttons on vertical stanchions throughout bus.",
                "selected": false
            },
            {
                "name": "Check installation and operation of stop request sign in ceiling mounted \u2018Infotainment\u2019 signs above white standee line and ahead of exit door. (Sign shall illuminate upon stop request chime activation and remain illuminated until one of the bus's doors has been opened and closed.)",
                "selected": false
            },
            {
                "name": "Check installation and operation of passenger stop request chimes (One in the driver's area & one near the rear exit doors).",
                "selected": false
            },
            {
                "name": "Check that horizontal handrail at entrance door and all door grab bars and touch bars are high visibility yellow and there are no drawstring or other catch points. Check that all stanchions throughout bus are stainless steel with high visibility yellow powder coat. .",
                "selected": false
            }
        ]
    },
    {
        "heading": "LE65 - Vehicle Interior",
        "tasks": [
            {
                "name": "Check entrance door area, grab rails, stanchions etc\u2026 for bright yellow powder coat, snag/drawstring catch or pinch points and proper knuckle clearance. Check entrance door fit and operation. Verify proper operation of entrance door sensitive edge and door alarms. Note opening and closing speeds on Road Test Summary Sheet.",
                "selected": false
            },
            {
                "name": "Check exit door area, grab rails, touch bars, stanchions etc\u2026 for bright yellow powder coat, snag/drawstring catch or pinch points and proper knuckle clearance. Check exit door fit and operation (see TTC specification for details on door operation). Verify proper operation of exit door touch bars, sensitive edges and door alarm. Note opening and closing speeds on Road Test Summary Sheet.",
                "selected": false
            },
            {
                "name": "Check for proper operation of entrance and exit door emergency release mechanisms. Check that panels behind transparent frangible panels have been painted or otherwise finished and that English and French instruction plaques are securely installed adjacent to frangible panels.",
                "selected": false
            },
            {
                "name": "Check fit, finish and operation of all passenger window installations. (All windows with a gray tint providing approx. 50% light transmittancy and windows have sacrificial interior surface vandal liner/film. Except for first & last window on each side, each window tips-in at top and has a fixed lower section. Except for first window on each side, windows in the low floor area are equipped with a red emergency egress release handle on one side \u2013 black handles facilitate window opening for non-emergency maintenance purposes. Windows in the raised floor area are non-egress type.) Check for sharp edges, catch points on frames and handles. Check operation of square key latches on all tip-in windows. Open & close all tip in windows and check for proper fit, adjustment & latch operation. Open & close locks on all windows using emergency or maintenance release handle and check for proper fit and adjustment.",
                "selected": false
            },
            {
                "name": "Check that each window equipped with a red emergency escape release handle is also equipped with an English / French \u201cidentification / instruction\u201d emergency window plaque.",
                "selected": false
            },
            {
                "name": "Check that English / French \u201clocation of\u201d nearest red emergency window handle plaque is installed beneath each passenger window as per set arrangement.",
                "selected": false
            },
            {
                "name": "Check interior of windshield for secure fit, damage and noticeable distortion. Windshield should have dark tint band across top.",
                "selected": false
            },
            {
                "name": "Check installation of Transpec rear manual roof vent / emergency hatch. Check for English/French emergency escape identification and instructions. Verify safety cable installed on rear roof hatch. Check operation of vent and emergency escape hatch.",
                "selected": false
            },
            {
                "name": "Check for proper installation of grey vinyl grab straps on horizontal stanchions (snug fit on stanchion tube, hardware assembled using Loctite, approx. 3ft spacing).",
                "selected": false
            },
            {
                "name": "Check for proper passenger seating configuration using approved Nova drawing. (Hip to knee spacing shall be 26\u201d minimum except as noted with additional space divided evenly wherever possible.) Check for proper assembly and secure mounting, proper operation of folding seats, trash closeouts installed and no sharp edges. All seats shall be equipped with grey fiberglass shells and red Holdsworth cloth covered inserts with padded base inserts (Single and bench type folding seats are to have blue cloth). All forward facing seats not backed against a wall or modesty panel shall be equipped with recessed back panels and grab handles.",
                "selected": false
            },
            {
                "name": "Check all concealed areas of bus interior for accumulation of trash or manufacturing debris.",
                "selected": false
            },
            {
                "name": "Check horizontal and vertical stanchion arrangement throughout bus for proper configuration using approved drawing (note that all stanchion assemblies are S/S with a bright yellow powder coat finish). Check for proper stanchion installation and hardware assembly with Loctite used on all fasteners and all fasteners properly tightened with no catch hazards. Check for red 72\u201d height marker on stanchion behind entrance door.",
                "selected": false
            },
            {
                "name": "Check all interior trim panels for secure and proper fit and finish \u2013 no gaps, sharp edges or protrusions. Check for over spray of paint and/or adhesives & sealers. Ensure that all seams are neat, snag free and sealed where necessary. Verify Docket 90 flame and smoke compliant panels used throughout.",
                "selected": false
            },
            {
                "name": "Check ceiling and interior lighting / sign panels for proper fit, finish and secure mounting. Ensure all trim caps and filler strips properly installed (notched filler strips where access is required for component maintenance). Where applicable, check antenna cable access cut-outs properly centered below rooftop antenna connection points. Note: Antenna cable ceiling access panels, entrance and exit door motor access panels along with some passenger lighting/HVAC duct panels, front destination sign access door, bridge panel and rear ceiling mounted electrical panel doors should all remain open to provide a clear view of all leak prone areas during water test procedures. Check antenna cables routing, securement and verify that roof insulation is cut back properly around antenna connections (connection centered in minimum 4\u201d diameter insulation cutout).",
                "selected": false
            },
            {
                "name": "Check for installation of 6 ceiling speakers. All speaker are to interface with the TTC Vision system.",
                "selected": false
            },
            {
                "name": "Check for installation of 5 interior view security cameras (check approved OEM drawing for exact locations). Check Digital Video Recorder and other related equipment has been properly installed per drawing. Verify system is operational and that cameras have been properly aimed (compare check print image from bus cameras to TTC supplied reference print of desired images \u2013 check print from each bus is to be included with vehicle document package).",
                "selected": false
            },
            {
                "name": "Check for installation of Forward Facing security camera (check approved OEM drawing for exact locations). Ensure camera boot is flush to windshield. Verify system is operational and that camera has been properly aimed (compare check print image from bus cameras to TTC supplied reference print of desired images \u2013 check print from each bus is to be included with vehicle document package).",
                "selected": false
            },
            {
                "name": "Check for correct installation of all TTC required interior decals (i.e. please exit at rear, please move back, a little further back, thank you for moving back, in the interest of safety, you may be requested, must deposit own fare, no smoking, push, to exit, caution bus lowers, etc.). Refer to TTC supplied drawing.",
                "selected": false
            },
            {
                "name": "Check for correct installation of all interior fleet number, (front and back of bus interior), component ID (i.e. release knobs/handles), and warning decals/plaques, (i.e. watch step, stand clear),",
                "selected": false
            },
            {
                "name": "Check for proper installation of all TTC required interior hardware items (i.e. take one hooks, fare sign frame, trash bag, transfer cutter, Vision touchpad mount, array microphone, etc.).",
                "selected": false
            },
            {
                "name": "Check modesty panels at exit doors and on either side of the rear raised floor area for proper installation (i.e. secure, rattle free) and lack of snag or pinch points. All modesty panels have clear Plexiglas top section, solid lower section. Low floor modesty panel has lower edge spaced sufficiently high from floor surface to facilitate access to W/C securement retractor release levers. Raised floor modesty panels have toe space cutouts, panel behind exit door has hooded cover over cutout.",
                "selected": false
            },
            {
                "name": "Check all equipment and storage compartments for proper configuration and supply of equipment (i.e. first aid kit, flare kit, plastic tub containing scooter belts, fire extinguisher etc.). Check for accumulation of trash or manufacturing debris.",
                "selected": false
            },
            {
                "name": "Check interior electrical and mechanical component cabinets for proper lighting and installation of equipment (i.e. neat, secure and matches Nova drawing). Electrical harnesses should include 10% spares, sufficient slack for properly radiuses connections and future repairs (minimum 3). Harnesses shall be properly loomed (seam at bottom where applicable) and secured using support clips with mechanical fasteners (no stick on supports, contractor hose only as approved by TTC, and tie wraps only to bundle, not for support). Grommets shall be used in through panel openings etc. Check for accumulation of trash or manufacturing debris.",
                "selected": false
            },
            {
                "name": "Check that all electrical compartments include permanent component/terminal identification diagrams, which also identify the circuits for each component.",
                "selected": false
            },
            {
                "name": "Check installation of yellow nosing at exit door step and two rear interior steps (i.e. flush, secure and properly welded/sealed). Check installation of yellow nosing on driver's platform & step (i.e. secure and properly welded). Check yellow/black diagonal stripe film applied at interior/exterior ramp side edges above rear seat and above IT box lower edge, above any raised seat step up areas where there may be a bump hazard.",
                "selected": false
            },
            {
                "name": "Check all interior lighting for proper operation. Verify auto dimming and extinguishing of front lamps upon closing entrance doors (1st roadside lamp dims, 1st curbside lamp extinguishes, 2nd and 3rd curbside lamps dim). Confirm that cleaner switch activates all fluorescent lighting on a 15- minute timer. Check day/night run dimming feature.",
                "selected": false
            },
            {
                "name": "Check that entrance door mechanism access panel is secured using \u00bc turn latches.",
                "selected": false
            },
            {
                "name": "Check entrance and exit door header LED strip type flood lamps for proper operation (front on/off with door open/close and rear exits on with door open, off with 5 second delay after closing) and installation of deflector to minimize light directed towards interior of bus.",
                "selected": false
            },
            {
                "name": "Check rear exit door green \u201cdoor authorized\u201d LED lighting for proper operation (doors authorized to open or doors open).",
                "selected": false
            },
            {
                "name": "Check for proper installation and operation of Webasto/Spheros heater timer and ramp counter. Check for accumulation of trash or manufacturing debris.",
                "selected": false
            },
            {
                "name": "Check exit door heating for adequate air flow around exit doorway. Check entrance door/ramp heating for proper operation and air flow.",
                "selected": false
            },
            {
                "name": "Check passenger area heating, ventilation, A/C systems for proper and quiet operation in all modes. Rocker switches on upper panel for \u201cOff / On\u201d rocker switch and for \u201cHigh/Low\u201d blower operation. Check thermostat settings (65?F for heat and 72?F for A/C) and record in Road Test Summary Sheet. Inspect grilles and filters and trash/splash guards for proper installation where applicable. Verify secure and proper installation of baseboard convector heaters and operation of convection blowers. Check installation for catch / bump hazards. Verify HVAC gauges/thermostat controls hidden from passenger's view and access.",
                "selected": false
            },
            {
                "name": "Check for correct installation location and operation of (min) 12 USB Passenger charging ports. (Check power indication lights and socket covers)",
                "selected": false
            },
            {
                "name": "If possible, check that refrigerant sight glass installed in convenient location and that system pressure gauges or digital display is installed in overhead interior electrical compartment along with MCC diagnostics / setting keypad (Heat @ 65\u00b0F, Cool @ 72\u00b0F). Verify proper settings, refrigerant charge and quiet, vibration free, efficient operation.",
                "selected": false
            },
            {
                "name": "Check for proper installation of 60 amp DC-DC convertor to facilitate powering standard bus equipment (i.e. secure mounting, proper electrical wire/cable routing and securement). Verify that a second 60 amp clean DC-DC power converter provided for TTC radios and electronics (located in a driver's area electrical compartment or ITS box).",
                "selected": false
            }
        ]
    },
    {
        "heading": "LE65 - Vehicle Exterior",
        "tasks": [
            {
                "name": "Check for proper installation of all exterior logos, decals, and fleet numbers per approved OEM drawing.",
                "selected": false
            },
            {
                "name": "Check for satisfactory exterior body finish. (i.e. No visible damage or manufacturing irregularities. Check decal scheme/striping against approved drawing. Check colors against sample chips.)",
                "selected": false
            },
            {
                "name": "Check exterior body panels, roof fairings, doors and trim for proper fit (edges flush with adjacent surface, gaps even and appropriate width), alignment and securement, gel coat or material imperfections and visible damage. Check panel seam Sika treatment per approved Nova drawing. Check exterior body for sharp edges and catch points.",
                "selected": false
            },
            {
                "name": "Check passenger windows for proper fit (windows installed into structure straight and at a uniform depth around perimeter, Sika seams around perimeter are neat with gaps even and appropriate width), no excess sealer, marks, scratches, distortion or chips.",
                "selected": false
            },
            {
                "name": "Check driver's window for proper fit, no excess sealer, marks, scratches distortion or chips.",
                "selected": false
            },
            {
                "name": "Check windshield for proper fit, no excess sealer, marks, scratches, distortion or chips. Ensure edges of windshield seal sit flush with glass and body with no distortion.",
                "selected": false
            },
            {
                "name": "Check fit, finish and operation of all exterior access doors and latches (where \u00bc turn square key locks are used, they shall accommodate a 5/16\u201d square key). Verify proper installation/operation of hinges, handles, bumpers, restraints and latches. Check weather seals and door fit. Verify proper installation of identification tags or instruction decals noting fuel, oil, battery, etc\u2026 Verify battery compartment cut out switch access door installed. Check schematics, warnings, instruction or identification plaques or labels provided inside of doors as required. Check that all exterior compartments are clean and free of manufacturing debris. Where applicable, check operation of compartment lamps.",
                "selected": false
            },
            {
                "name": "Check installation and operation of all access door props. Check for provision and proper operation of safety braces on gas spring supported doors.",
                "selected": false
            },
            {
                "name": "Check the fuel tank (86 usable US gal) & filler assembly and DEF tank (8.3 usable US gal) and filler for correct installation and ease of access for filling. Check fuel tank vent hoses properly routed (no kinks) and secured with constant torque clamps and pressure relief/overflow tubes terminated below bus frame. Verify Emco Wheaton Posi Lock system with flip cap installed (centered in opening, cap folds open towards the front). Ensure filler neck valve parts supplied in bus interior storage compartment for TTC installation. DEF tank does not require dry lock filler",
                "selected": false
            },
            {
                "name": "Check ramp hydraulic system fluid level, washer fluid level and installation of front shop air supply fitting with shut off tap and check valve in line (located under & behind the front bumper).",
                "selected": false
            },
            {
                "name": "Check installation of rubber fender skirts, ensure proper and secure fit & sealing.",
                "selected": false
            },
            {
                "name": "Check passenger doors for proper fit, seal and alignment with no visible damage or scratches to black anodized finishes. Check for secure, flush and properly sealed installation of door opening trim and moldings. Check that exposed frame area below exit doors and front door ramp mechanism skid plates are painted black.",
                "selected": false
            },
            {
                "name": "Check for proper installation of rain gutters over driver's side window and doors.",
                "selected": false
            },
            {
                "name": "Check for proper installation of 21\u201d x 70\u201d rear and 30\u201d x 139\u201d road side white powder coat, anodized aluminum ad frame (bottom loading). Nylon spacers shall be installed between the frame and the bus's body panels and closed cell foam tape at the leading edge of the side frames. Check for sharp edges.",
                "selected": false
            },
            {
                "name": "Check for proper front and rear license plate mounting provisions including mounting hardware and LED rear license plate lamp.",
                "selected": false
            },
            {
                "name": "Check for proper installation of front and dual rear Goodyear Metro Miler G652 RTB Radial contract tires (305/70R \u2013 22.5, min 55mph rating - 120psi) allowing for easy access to all valve stems (special \u201cAlligator\u201d stem caps on all, no valve stem extensions on inner duals).",
                "selected": false
            },
            {
                "name": "Check for proper installation of Alcoa Aluminum, heavy duty wheels with Dura-Flange\u00ae or equivalent rim flange protection and Dura- Bright or equivalent finish protection. Check mounting surface of axle hubs, brake rotors and wheel studs are unpainted where there is contact with the wheels. Wheel nuts shall be unpainted. Verify grease lubricated front and rear type wheel bearings are provided.",
                "selected": false
            },
            {
                "name": "Check torque seal paint applied to all wheel nuts to verify they were torqued.",
                "selected": false
            },
            {
                "name": "Check for proper installation and operation of correct exterior reflectors, lamps, guards & hoods. Ensure that all exterior light lenses are undamaged (i.e. check for damage due to impact or over tightening). Note: All exterior lamps are LED. All LED lamps are Dialight except license lamp. Exit door flood lamps are on a 5 second delay after door closes, entrance door lamps shut off immediately after door closing. An amber LED \u201cRegan braking off\u201d indicator lamp shall be located below the driver's side windshield.",
                "selected": false
            },
            {
                "name": "Check for proper installation and operation of correct bike rack on front bumper (Sportworks DL2-NP, with low profile mount, white powder coated stainless steel, with operating instructions and reflective tape applied as per OEM drawing).",
                "selected": false
            },
            {
                "name": "Check for proper installation of Lucerix exterior mirrors and mounting equipment. (Curb side is rectangular, remote, heated 2 section convex with double tube arm and quick release bracket. Road side is rectangular with flat upper lens and convex lower lens, both are remote controlled and heated. Road side has double tube arm with 2 detent positions and a quick release bracket. Both mirrors have sealed electrical connections at base of mirror arm with wiring routed through arm. Both mirrors have amber LED lamps strips to work as running and signal lamps) Inspect exterior mirror equipment for proper clearance, operation, and no visible damage. Verify that assemblies are securely mounted to minimize component vibration.",
                "selected": false
            },
            {
                "name": "Check for proper installation of destination sign equipment (i.e. Horizon SMT LED front sign, Horizon side & rear signs shall be mounted secure, properly sealed and aligned correctly, front and side signs shall be hinged to facilitate cleaning and include auto brightness feature). Ensure sign is loaded with a test program and complete a thorough operational check (including function of all LEDs and auto dim feature).",
                "selected": false
            },
            {
                "name": "Check for installation of heated front sign glass and masked blue LED lamps installed either side of front sign. Note that blue lamps may be disconnected for bus delivery purposes.",
                "selected": false
            },
            {
                "name": "Check roof surface for signs of damage/distortion. Verify proper sealing of body end caps to roof, roof to roof coves, hatches, antennas and antenna ground plane panels (each antenna shall have a bead of Sika applied around the perimeter of the base providing a visible seal to the roof surface, securement screws shall also be sealed with Sika \u2013 no Sika to be applied under antenna mounting bases). Note: Smart Yard antenna is centered, behind front roof fairing are to either side of the roof behind the front roof fairing. (see OEM layout drawing for details).",
                "selected": false
            },
            {
                "name": "Check proper installation and sealing of Transpec rear roof hatches/ventilator. Hatches should hinge towards front of bus for emergency escape.",
                "selected": false
            },
            {
                "name": "Check installation of roof mounted HVAC. Check units are properly leveled, secured and sealed to roof surface. Check routing and securement of HVAC wiring harnesses, refrigerant lines, heater plumbing and condensate hoses. Ensure no visible damage to unit and that all necessary insulation packages, access covers, protective screens and filters are securely in place.",
                "selected": false
            },
            {
                "name": "Check installation of BAE Energy Storage System, PCS (Propulsion Control System) Traction Motor/Generator and APS (Accessory Power System) to ensure all are properly secured, leveled and sealed as required. Check routing and securement of all attached electrical harnesses and plumbing. Verify no visible damage to any equipment and that all access covers, screens, filter etc., are securely in place.",
                "selected": false
            },
            {
                "name": "Check installation of electrically driven air compressor, along with proper and secure routing of cables and lines.",
                "selected": false
            },
            {
                "name": "Verify supply of brushless condenser fan motors and evaporator blower motors and that all blower fans work properly and quietly.",
                "selected": false
            },
            {
                "name": "Check for proper installation of roof surface non slip tape around hatch opening, and over to each piece of roof mounted equipment or antenna to facilitate any work on roof to repair and/or replace equipment \u2013 see Nova drawing for tape layout.",
                "selected": false
            },
            {
                "name": "Check front and rear bumpers for visible damage, along with proper mounting and alignment. Ensure skid bar is installed behind curb side corner of front bumper.",
                "selected": false
            },
            {
                "name": "Check for installation of pennant holder behind front door opening.",
                "selected": false
            },
            {
                "name": "Check for installation of 4 exterior (wedge) security cameras (check approved OEM drawing for exact locations). Verify system is operational and that cameras have been properly aimed (compare check print image from bus cameras to TTC supplied reference print of desired images \u2013 check print from each bus is to be included with vehicle document package). Check that lens windows are clear and free of condensation and/or fogging.",
                "selected": false
            },
            {
                "name": "Check for installation of 1 exterior rear security cameras (check approved OEM drawing for exact locations). Verify system is operational and that cameras have been properly aimed (compare check print image from bus cameras to TTC supplied reference print of desired images \u2013 check print from each bus is to be included with vehicle document package). Check that lens windows are clear and free of condensation and/or fogging.",
                "selected": false
            }
        ]
    },
    {
        "heading": "LE65 - Engine Compartment",
        "tasks": [
            {
                "name": "Check all exterior access doors at rear of bus for proper installation, operation and fit (i.e. main rear and side engine compartment access doors, air cleaner and muffler (CAT/DPF and DEF injector assembly) compartment door, radiator access door, battery compartment and battery control access doors, DEF tank and air dryer access door). Check interior of access door panels for required signage and any indications of contact with bus equipment.",
                "selected": false
            },
            {
                "name": "Check operation of compartment door handles, straps, prop rods, gas struts and safety latch mechanisms. Check operation of compartment door locks or slam latches where present.",
                "selected": false
            },
            {
                "name": "Check that screened upper radiator door properly fitted and secured.",
                "selected": false
            },
            {
                "name": "Check installation of engine and muffler compartment insulation (proper materials and coverage, secure installation, sealed seams) and ensure compartments are properly sealed from passenger compartment. Ensure all protruding compartment wall studs are capped to prevent worker injury.",
                "selected": false
            },
            {
                "name": "Check Cummins ISB engine / BAE HDS 200 powertrain major component mounting and cradle properly installed (i.e. component and cradle mounting bolts properly torqued, torque seal paint applied).",
                "selected": false
            },
            {
                "name": "Check all connections at bulkhead (i.e. air, fluid and electrical) properly completed (tight, no leaks or loose terminals etc.).",
                "selected": false
            },
            {
                "name": "Check all air and fluid lines are properly routed and secured (all fuel and hydraulic piping shall be stainless steel, Nova installed high pressure lines shall be equipped with a nylon or elastomer coated overbraid, OEM engine, fuel & hydraulic high pressure lines may be equipped with a stainless steel overbraid \u2013 routing shall be such to optimize serviceability and minimize possible damage). All lines and hoses should be properly secured (P-clamps or block type mounts to maintain proper placement and support \u2013 tie wraps should only to be used for grouping, not for support).",
                "selected": false
            },
            {
                "name": "Check that all coolant hoses are 4 ply silicon and properly routed and secured (clamps properly adjusted and positioned for serviceability). Hoses shall be secured with Breeze constant torque clamps.",
                "selected": false
            },
            {
                "name": "Check that all coolant line shut off valves are operational and left in the \u201copen\u201d position.",
                "selected": false
            },
            {
                "name": "Check proper installation of coolant reservoir, pressure relief and test fittings, non-additive type coolant filter and correct level of OATs type ethylene glycol anti freeze solution (-25?F freeze protection). Check for (3) proper coolant levels using ACTIA display in engine compartment.",
                "selected": false
            },
            {
                "name": "Check installation and alignment of belts and belt driven components. Verify belt tension set correctly. Check installation of yellow painted belt guard.",
                "selected": false
            },
            {
                "name": "Verify installation of permanent I.D. tags at all fluid fill locations and where necessary, information, data, and warning decals/plaques are present for bus equipment.",
                "selected": false
            },
            {
                "name": "Check for ease of access to engine oil filler tube and dipstick. Check oil level and verify correct oil used for top-up. (15W-40 API CI-4)",
                "selected": false
            },
            {
                "name": "Check that air cleaner housing and plumbing is properly routed, sealed and secured.",
                "selected": false
            },
            {
                "name": "Check installation of air, fuel and lube filters for leaks and serviceability, check for proper installation of air restriction gauge.",
                "selected": false
            },
            {
                "name": "Check that battery boost plug (Anderson #6320G1-24V \u2013 grey) properly installed, lubricated and capped.",
                "selected": false
            },
            {
                "name": "Check for proper installation of shop air supply line, check and manual valves and fitting (1) in rear engine compartment and (1) at front of bus.",
                "selected": false
            },
            {
                "name": "Check that the desiccant air dryer is properly installed (i.e. secure mounting, inlet cooling coil and all air lines and harnesses properly routed) with Bendix heated auto drain valve on wet tank (manual drain valves on other air tanks). Verify proper operation of components.",
                "selected": false
            },
            {
                "name": "Check for proper installation of Kidde Fire Suppression System Reservoir. Gauge should be easy to view, showing a full charge (needle in green) and all hoses and wiring shall be properly supported and routed to prevent damage.",
                "selected": false
            },
            {
                "name": "Check that routing and securement of Fire Suppression System LTD wire is as per the arrangement approved by Kidde. Ensure that LTD wire is not being pinched or chafed. Ensure that all nozzles and sensors are positioned and secured properly.",
                "selected": false
            },
            {
                "name": "Check that engine exhaust outlet exits road side corner of roof with curved venturie style diffuser tip protruding at least 6\u201d above roof and directed towards rear roadside corner of bus (all exhaust system components and hardware should be stainless steel).",
                "selected": false
            },
            {
                "name": "Check installation of the Auxiliary Diesel Coolant Heater (i.e. secure mounting, serviceability, proper securement and routing of air and fuel lines, electrical harnesses and exhaust piping). Verify heat shields installed as required.",
                "selected": false
            },
            {
                "name": "Check operation of Auxiliary Diesel Heater Maintenance Switch on engine compartment consol.",
                "selected": false
            },
            {
                "name": "Check that Rotron brushless / seal-less coolant circulating pump properly installed.",
                "selected": false
            },
            {
                "name": "Check installation of A/C compressor, and ensure proper routing and securement of refrigerant lines, hoses and fittings. Check that compressor operates on modulating cylinder and recycling clutch basis (on-off based on cooling demands, not on continuously as in regenerative system). Check A/C system wiring harness for proper routing, securement, protective looms and secure sealed connections.",
                "selected": false
            },
            {
                "name": "Check proper engine compartment gauges are provided (Tachometer + ACTIA display, indicator lamps, switches for Coolant pump, Compt Lights, Aux Htr, Eng Stop/Start, Frt/Rear Eng start \u2013 unused panel holes plugged) and verify operation.",
                "selected": false
            },
            {
                "name": "Check that all engine and rear compartment wiring and plumbing is properly routed and secured per Nova bus installation drawings (no rub or pinch points, radiuses at bends and appropriate slack provided throughout to ensure no tension is applied). All cables and wiring should be properly secured and loomed where necessary. Support and securement of plumbing and wiring should be by P-clamps or nylon block type clamps wherever possible \u2013 tie wraps should only be used for grouping, not for support. Sealed weather resistant electrical connectors shall be used throughout. All exposed terminals shall have the appropriate protective coating applied. Plumbing connections shall be made with constant torque clamps, standard compression fittings or standard SAE or JIC high pressure fittings as appropriate (fittings shall be stainless steel or plated). Ensure sufficient slack is provided at harness ends and connection points to allow for ease of maintenance, flex and future repairs (sufficient for a minimum of 3 connection replacements). All harnesses should have a minimum of 10% spare wires included.",
                "selected": false
            },
            {
                "name": "Check proper engine compartment switches are provided (front/rear run, rear start, compartment lights, heater maintenance, emergency engine shut down & safety knife switch \u2013 unused panel holes plugged) and verify operation.",
                "selected": false
            },
            {
                "name": "Check for reasonable accessibility to all regular maintenance components.",
                "selected": false
            },
            {
                "name": "Check electrical junction panels and studs are secure and cables properly tightened and ensure application of protective sealant to exposed electrical terminals (including ground studs)",
                "selected": false
            },
            {
                "name": "Check for proper operation and installation of LED engine compartment lighting to facilitate routine maintenance (4 lamp assemblies).",
                "selected": false
            },
            {
                "name": "Check AGM bus start and accessory batteries and battery isolation switch, battery cable routing and connections (i.e. batteries and switch secure, cables properly secured and free of possible pinch or chafe conditions, cable ends are properly crimped and secured with anti-corrosion treatment applied). Check main ground connections properly crimped, secure and anti-corrosion treatment applied.",
                "selected": false
            },
            {
                "name": "Check installation and operation of standard bus battery quick disconnect switch (i.e. \u201don\u201d @ 9:00 position / \u201coff\u201d @ 6:00 position with lockout tab also @ 6:00 position, proper cable routing and securement and switch secure).",
                "selected": false
            },
            {
                "name": "Check battery compartment closeouts, drains and ventilation openings.",
                "selected": false
            },
            {
                "name": "Check battery purchase date no more than 60 days from date of bus shipment.",
                "selected": false
            },
            {
                "name": "Check battery compartment tray, tray slides and latches and battery spacers and battery hold down securement. Ensure battery tray properly secured and latched (hex bolt and hook latch).",
                "selected": false
            },
            {
                "name": "Check for and record bus frame serial number on data sheet.",
                "selected": false
            }
        ]
    },
    {
        "heading": "LE65 - Vehicle Understructure",
        "tasks": [
            {
                "name": "Check front and rear air suspension, air bellows, mounting plates/fasteners for proper installation and ensure no interference with the bellows when the suspension is raised or lowered. Check bus manufacturer assembled/installed component fasteners for torque seal paint to verify components were properly torqued.",
                "selected": false
            },
            {
                "name": "Check front and rear air suspension air line routing, leveling valves and control units for proper installation.",
                "selected": false
            },
            {
                "name": "Check front and rear shock absorbers and their mounts for proper installation and application of torque seal to attachment hardware.",
                "selected": false
            },
            {
                "name": "Check steering shaft, steering gear, steering linkages for proper installation. Verify cotter pins properly installed where applicable. Verify gap in tie rod sleeves and clamps are spaced 180\u00b0 apart. Verify torque seal paint applied to all bus manufacturer assembled/installed components and critical steering system fasteners to confirm they were torqued.",
                "selected": false
            },
            {
                "name": "Check steering hydraulic and mechanical stops have been correctly adjusted and that there is no tire or steering gear/linkage contact with other bus components or body/structure through complete stop to stop travel with suspension at any height.",
                "selected": false
            },
            {
                "name": "Check that all steering gear and linkages have been lubricated.",
                "selected": false
            },
            {
                "name": "Check front and rear suspension radius/torque rods and suspension beams for proper installation and application of torque seal paint to verify component fasteners have been torqued.",
                "selected": false
            },
            {
                "name": "Check that front and rear wheel well areas have undercoatingcompound properly applied.",
                "selected": false
            },
            {
                "name": "Check that all exposed bus structure has the appropriate corrosion preventative coatings applied with no visible blemishes or areas with inadequate coverage.",
                "selected": false
            },
            {
                "name": "Check for proper masking of switches, solenoids, valves, vents and bellows (where applicable). Ensure that all masking is removed. Check for paint or undercoating over-spray where it may adversely affect component operation or service life.",
                "selected": false
            },
            {
                "name": "Check all exposed bus manufacturer installed fasteners used on the underside of the bus are either stainless steel or plated as appropriate for the application for corrosion resistance.",
                "selected": false
            },
            {
                "name": "Check that caulking is applied between edges of structure and sub- floor along with any openings used for harness and hose routing and the ends of any exposed fasteners etc. protruding from the underside of the bus floor.",
                "selected": false
            },
            {
                "name": "Check all underside areas for proper attachment of skirting and closeout panels (battery tray slide closeouts and elsewhere as required).",
                "selected": false
            },
            {
                "name": "Check wheelchair ramp for installation of dust and road spray shields, skid plates, secured wiring, air-lines, and hydraulic tubing.",
                "selected": false
            },
            {
                "name": "Check for proper installation of traffic signal priority transponder (i.e. near front, within 8\u201d of bus centerline, black line on transponder faces front or back, cable secured and routed properly).",
                "selected": false
            },
            {
                "name": "Check for proper installation of three piece front and rear mud flaps. Check for static strap (tie up to proper length as required).",
                "selected": false
            },
            {
                "name": "Check for supply of front and rear tow chain securement eyelets or suitable frame location for tow chain securement where harnesses and plumbing won\u2019t be damaged.",
                "selected": false
            },
            {
                "name": "Check for front and rear towing & jacking / hoisting pads (adequately identified, i.e. Painted yellow and location decals on exterior panels) and front frame lifting reinforcements (behind front bumper).",
                "selected": false
            },
            {
                "name": "Check for proper installation of floor drain valves/seals.",
                "selected": false
            },
            {
                "name": "Check plastic fuel and DEF tanks for proper installation, no leaks and plywood shielding beneath fuel tank installed correctly. Check that edges of plywood shield are sealed with caulking along with the ends of any exposed fasteners etc. protruding through the shield.",
                "selected": false
            },
            {
                "name": "Check all underbody air and fluid lines/hoses (bumper to bumper, including those hidden behind dust shields) and ensure they are properly secured and routed in a manner to minimize unnecessary stress or movement and prevent chafe. Verify grommets are properly installed to protect lines/hoses where they pass through small openings and that a suitable seal is provided where the line/hose passes through to the interior of the bus. Verify lines/hoses have proper radius at bends and are shielded from heat where necessary and no push-in fittings. Verify that hose clamps, fittings and related components are installed in a manner that they can be easily serviced. Check connection points at engine cradle area for proper assembly. Check heater lines properly and thoroughly insulated. Check all shut-off valves easily accessible, operational and left open. Check for seepage and/or leaks.",
                "selected": false
            },
            {
                "name": "Check all underbody wiring and electrical harnesses (bumper to bumper, including those hidden behind dust shields) and ensure they are properly secured and routed in a manner to minimize unnecessary stress or movement and prevent chafe. Verify grommets are properly installed to protect wiring/harnesses where they pass through small openings and that bulkhead connectors are provided where the wiring/harnesses pass through to the interior of the bus. Verify wiring/harnesses have proper radius at bends and are shielded from heat where necessary. Verify that sealed water-resistant connectors are properly installed in a manner that they can be easily serviced and that drip loops are included in the harness as required. Check that all wiring is provided with sufficient slack at each end to ensure there will be no strain on the wiring and to facilitate repairs. Check all exposed electrical connections and ground studs have protective coating applied.",
                "selected": false
            },
            {
                "name": "Check front and rear brake hardware to ensure proper assembly, lubrication and adjustment. Check no coatings overspray on brake rotors. Verify proper installation and adjustment of brake chambers. Check bus manufacturer assembled/installed component fasteners for torque seal paint to verify components were properly torqued.",
                "selected": false
            },
            {
                "name": "Check for correct installation of front and rear brake ABS and Traction Control equipment (i.e. valves, sensors, proper routing of wiring and hoses).",
                "selected": false
            },
            {
                "name": "Check for front and rear brake system air leaks and that brake hoses do not rub, stretch or kink when suspension raised or lowered or wheels are turned to steering stops in either direction.",
                "selected": false
            },
            {
                "name": "Check for proper operation of rear spring brake (i.e. smooth and quick application and release).",
                "selected": false
            },
            {
                "name": "Check air reservoirs for secure installation and provision of high quality ball type manual drain valves. Check heated Expello auto drain valve on wet tank.",
                "selected": false
            },
            {
                "name": "Check that engine and hybrid motor/generator assemblies have been properly installed and check that torque seal paint was applied to attachment fasteners to verify they were properly torqued.",
                "selected": false
            },
            {
                "name": "Check that driveshaft properly installed and torque seal applied to fasteners. Check that no coatings overspray on driveshaft. Check that U-joints and Slip Yoke have been lubricated.",
                "selected": false
            },
            {
                "name": "Check rear axle for proper installation. Check axle oil level and verify correct oil used for top-up if needed.",
                "selected": false
            },
            {
                "name": "Check installation of Auxiliary Diesel Heater exhaust pipe (points down to road surface near side of bus).",
                "selected": false
            }
        ]
    },
    {
        "heading": "LE65 - Road Test",
        "tasks": [
            {
                "name": "--- Prior to completing Road Test, verify Nova Bus have already completed and signed off their QA Water Test---",
                "selected": false
            },
            {
                "name": "-- Complete Road Test Prior to Completing TTC Water Test --",
                "selected": false
            },   
            {
                "name": "Using Road Test Summary Sheet, check and record the step and bumper heights.",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check and record the entrance and exit door operation and timing.",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check and record the operation of the HVAC system using ambient temperature as an index point.",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check that roof mounted, electrically driven AC compressor work's quietly and vibration free to control interior temperatures in cooling mode.",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check and record observations concerning HVAC and heating systems operation for noise, rattles, vibrations, condensation leakage into interior or other abnormalities, particularly around the blower motors, pumps and compressor. Check for even and adequate system air flow (all modes).",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check and record operation of service brake (i.e. stopping distance, no air leaks, abnormal noises, pulling, drifting, coasting or grabbing).",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check and record operation of parking brake. (i.e. stopping performance, holds bus on light acceleration)",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check and record operation of regen braking and operation of disable switch & lamp.",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check and record operation of brake and accelerator interlock systems, (i.e. operate with entrance and exit doors, kneeling system and ramp system, release only on application of Service Brake application upon completion of system cycle).",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check and record time required for bus to accelerate to set speeds and verify that acceleration is smooth and quiet.",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check and record the vehicle turning radius is as specified, in both directions (43 \u00bd ft.). (Note: First 5 buses should be checked and then if OK, only every 10th bus.)",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check and record engine RPM at low idle, fast idle, and maximum governed engine speed. Ensure engine speeds are to specification.",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check and record the roof mounted, electric driven air compressor cut-in and cut-out pressures and build-up time between compressor cut-in and cut- out.",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check for and record observations concerning ride comfort (i.e. OK, or excessively harsh or excessively soft bouncy/rolling type ride).",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check for and record observations concerning excessive squeaks, rattles, clunks and/or abnormal operating noises.",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check for and record observations concerning steering and general handling of the vehicle on dry pavement.",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check for and record observations concerning excessive and/or abnormal Powertrain or Drive Axle component noises or vibrations.",
                "selected": false
            },
            {
                "name": "Using Road Test Summary Sheet, check for and record observations concerning excessive air leakage or wind noises from around windows and doors etc.",
                "selected": false
            },
            {
                "name": "After the road test, check for visible interior coolant leaks at floor surrounding driver and passenger heaters and plumbing connections or from ceiling mounted heater and plumbing and check for improper AC condensate drainage into ventilation ducts.",
                "selected": false
            },
            {
                "name": "After the road test, ensure there are no visible fluid leaks under the bus or in the engine compartment. Check for audible air leaks.",
                "selected": false
            },
            {
                "name": "Check that the FMVSS certification sticker or plate is affixed to the vehicle.",
                "selected": false
            },
            {
                "name": "After the road test, obtain copy of curb and axle weight certificate and alignment sheets. Check for obvious errors and if OK, attach to inspection packet to be delivered with bus (includes completed Nova QA sign-off sheets, HVAC function check sheets, major components records list, road test sheets, turning radius check sheet, electrical function check sheets and TTC check sheets). Verify all Nova documents have been completed and signed off as appropriate before release with bus. (NVIS form and electronic copy of components list will be handled separately.)",
                "selected": false
            }
        ]
    },
    {
        "heading": "LE65 - Water Leak Test",
        "tasks": [
            {
                "name": "--- Prior to Completing TTC Water Test, verify Nova Bus have already completed and signed off their QA Water Test---",
                "selected": false
            },
            {
                "name": "-- Complete Road Test Prior to Completing TTC Water Test --",
                "selected": false
            },
            {
                "name": "Water test complete vehicle for a minimum duration of 15 minutes. (Antenna cable ceiling access panels, entrance and both exit door motor access panels along with some passenger lighting / HVAC duct panels, front destination sign access door, driver's area overhead electrical panels and rear wall electrical panel doors should all remain open to provide a clear view of all leak prone areas during water test procedures.)",
                "selected": false
            },
            {
                "name": "Check that there are no leaks present around the destination sign glass and windshields.",
                "selected": false
            },
            {
                "name": "Check that all doors seal properly at the top, bottom, sides, and edges and that there are no visible leaks present.",
                "selected": false
            },
            {
                "name": "Check driver and passenger side windows for proper sealing and that there are no visible leaks present.",
                "selected": false
            },
            {
                "name": "Check that the roof and roof mounted equipment and antenna are properly sealed with no visible leaks present.",
                "selected": false
            },
            {
                "name": "Check overhead escape hatches for proper operation and sealing.",
                "selected": false
            },
            {
                "name": "Check that there are no leaks present around the rear interior wall including inside the rear wall compartments.",
                "selected": false
            },
            {
                "name": "Check that there are no leaks present around the rooftop A/C unit, air ducts, plumbing, wiring and equipment access compartments.",
                "selected": false
            },
            {
                "name": "Check wheel housings for leakage from outside through to bus interior at seams and equipment bolt through points using a high pressure hose or wand.",
                "selected": false
            },
            {
                "name": "Immediately upon completion of water test and removal of bus from water test chamber, re-inspect interior of bus for residual water leaks.",
                "selected": false
            },
            {
                "name": "--If any leaks are identified during the TTC's Water Test, these should be reported to Nova Bus and once they claim to have made repairs, the process above should be repeated as necessary to verify all leaks are properly addressed.--",
                "selected": false
            }
        ]
    }
];


  portalPrefix: '/admin' | '/client' = '/client';

  tabs = [
    { key: 'general', label: 'General Project' },
    { key: 'inspection-categories', label: 'Inspection Categories' },
    { key: 'inspection-tasks', label: 'Inspection Tasks' },
    { key: 'vehicles', label: 'Vehicles' },
    { key: 'station-tracker', label: 'Station Tracker' },
    { key: 'files', label: 'Files' },
    { key: 'users', label: 'Users' },
  ];
  activeTab = 'general';

  get canManageProjects(): boolean {
    return this.portalPrefix === '/admin';
  }

  get selectedCategoryCount(): number {
    return this.inspectionCategories.filter(c => c.selected).length;
  }

  get allCategoriesSelected(): boolean {
    return this.inspectionCategories.every(c => c.selected);
  }

  get someCategoriesSelected(): boolean {
    return this.inspectionCategories.some(c => c.selected) && !this.allCategoriesSelected;
  }

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly router: Router,
    private readonly authService: AuthService,
    private readonly clientService: ClientService,
    private readonly locationService: LocationService,
    private readonly userManagementService: UserManagementService,
  ) {
    const context = resolveProjectManagementContext(this.authService.currentUserValue);
    this.portalPrefix = context.portalPrefix;
    this.initializeInspectionCategories();
  }

  private initializeInspectionCategories(): void {
    this.inspectionCategories = [
      { id: 1, name: "Driver Area", selected: false },
      { id: 2, name: "Undercarriage", selected: false },
      { id: 3, name: "Underbody - Steering", selected: false },
      { id: 4, name: "Driver's Area", selected: false },
      { id: 5, name: "Wheelchair Ramp and Accessible Features", selected: false },
      { id: 6, name: "Vehicle Interior", selected: false },
      { id: 7, name: "Vehicle Exterior", selected: false },
      { id: 8, name: "Vehicle Understructure", selected: false },
      { id: 9, name: "Road Test", selected: false },
      { id: 10, name: "Water Leak Test", selected: false },
      { id: 11, name: "12M - Vehicle Interior", selected: false },
      { id: 12, name: "12M - Vehicle Exterior", selected: false },
      { id: 13, name: "12M - Vehicle Understructure", selected: false },
      { id: 14, name: "12M - Engine Compartment", selected: false },
      { id: 15, name: "12M - Other Options", selected: false },
      { id: 16, name: "12M - Water Leak Test", selected: false },
      { id: 17, name: "12M - Road Test", selected: false },
      { id: 18, name: "7M - DA - Undercarriage - Lower Engine Compartment", selected: false },
      { id: 19, name: "7M - DA - Exterior", selected: false },
      { id: 20, name: "7M - DA - Interior", selected: false },
      { id: 21, name: "7M - DA - Driver's Area", selected: false },
      { id: 22, name: "7M - DA - Water Test", selected: false },
      { id: 23, name: "7M - DA - Road Test", selected: false },
      { id: 24, name: "60 FT - V - Interior Front Section", selected: false },
      { id: 25, name: "60 FT - V - Exterior", selected: false },
      { id: 26, name: "60 FT - V - Articulating Joint", selected: false },
      { id: 27, name: "60 FT - V - Interior Rear Section", selected: false },
      { id: 28, name: "60 FT - V - Engine Compartment", selected: false },
      { id: 29, name: "60 FT - V - Road Test", selected: false },
      { id: 30, name: "60 FT - V - Water Test", selected: false },
      { id: 31, name: "60FT - NFI - Driver's Area", selected: false },
      { id: 32, name: "60FT - NFI - Vehicle Interior", selected: false },
      { id: 33, name: "60FT - NFI - Vehicle Exterior", selected: false },
      { id: 34, name: "60FT - NFI - Engine Compartment", selected: false },
      { id: 35, name: "60FT - NFI - Vehicle Understructure", selected: false },
      { id: 36, name: "60FT - NFI - Road Test", selected: false },
      { id: 37, name: "60FT - NFI - Water Leak Test", selected: false },
      { id: 38, name: "LE65 - Driver's Area", selected: false },
      { id: 39, name: "LE65 - Wheelchair Ramp and Accessible Features", selected: false },
      { id: 40, name: "LE65 - Vehicle Interior", selected: false },
      { id: 41, name: "LE65 - Vehicle Exterior", selected: false },
      { id: 42, name: "LE65 - Engine Compartment", selected: false },
      { id: 43, name: "LE65 - Vehicle Understructure", selected: false },
      { id: 44, name: "LE65 - Road Test", selected: false },
      { id: 45, name: "LE65 - Water Leak Test", selected: false },
      { id: 46, name: "60 FT - V - Driver's Area/Front Entrance", selected: false },
      { id: 47, name: "60 FT - V - Undercarriage/Lower Engine Compartment", selected: false },
      { id: 48, name: "60FT - NFI - Wheelchair Ramp and Accessible Features", selected: false },
      { id: 49, name: "60FT - V - Wheelchair Ramp and Accessible Features", selected: false },
      { id: 50, name: "LE85 - YRT - Articulating Joint", selected: false },
      { id: 51, name: "LE85 - YRT - Driver's Area/Front Entrance", selected: false },
      { id: 52, name: "LE85 - YRT - Engine Compartment", selected: false },
      { id: 53, name: "LE85 - YRT - Exterior", selected: false },
      { id: 54, name: "LE85 - YRT - Interior Front Section", selected: false },
      { id: 55, name: "LE85 - YRT - Interior Rear Section", selected: false },
      { id: 56, name: "LE85 - YRT - Road Test", selected: false },
      { id: 57, name: "LE85 - YRT - Undercarriage/Lower Engine Compartment", selected: false },
      { id: 58, name: "LE85 - YRT - Water Test", selected: false },
      { id: 59, name: "LE65 - TTC - Driver's Area", selected: false },
      { id: 60, name: "LE65 - TTC - Engine Compartment", selected: false },
      { id: 61, name: "LE65 - TTC - Road Test", selected: false },
      { id: 62, name: "LE65 - TTC - Vehicle Exterior", selected: false },
      { id: 63, name: "LE65 - TTC - Vehicle Interior", selected: false },
      { id: 64, name: "LE65 - TTC - Vehicle Understructure", selected: false },
      { id: 65, name: "LE65 - TTC - Water Leak Test", selected: false },
      { id: 66, name: "LE65 - TTC - Wheelchair Ramp and Accessible Features", selected: false },
      { id: 67, name: "60 FT - LE85 - Interior Front Section", selected: false },
      { id: 68, name: "60 FT - LE85 - Interior Rear Section", selected: false },
      { id: 69, name: "60 FT - LE85 - Driver's Area/Front Entrance", selected: false },
      { id: 70, name: "60 FT - LE85 - Exterior", selected: false },
      { id: 71, name: "60 FT - LE85 - Undercarriage/Lower Engine Compartment", selected: false },
      { id: 72, name: "60 FT - LE85 - Engine Compartment", selected: false },
      { id: 73, name: "60 FT - LE85 - Articulating Joint", selected: false },
      { id: 74, name: "60 FT - LE85 - Water Test", selected: false },
      { id: 75, name: "60 FT - LE85 - Road Test", selected: false },
      { id: 76, name: "NOVA E-BUS - MOTOR COMPARTMENT", selected: false },
      { id: 77, name: "NOVA E-BUS - BODY EXTERIOR", selected: false },
      { id: 78, name: "NOVA E-BUS - PASSENGER SIGNAL", selected: false },
      { id: 79, name: "NOVA E-BUS - DRIVERS COMPARTMENT", selected: false },
      { id: 80, name: "NOVA E-BUS - BODY INTERIOR", selected: false },
      { id: 81, name: "NOVA E-BUS - WHEEL CHAIR", selected: false },
      { id: 82, name: "NOVA E-BUS - DOORS", selected: false },
      { id: 83, name: "NOVA E-BUS - BRAKES & AIR", selected: false },
      { id: 84, name: "NOVA E-BUS - UNDERSIDE COACH", selected: false },
      { id: 85, name: "NOVA E-BUS - HIGH VOLAGE SYSTEM", selected: false },
      { id: 86, name: "NOVA E-BUS - ROAD TEST", selected: false },
      { id: 87, name: "E-BUS - BEBs MOTOR COMPARTMENT", selected: false },
      { id: 88, name: "YRT - Bus Garage - A/C CLUTCH/ALT", selected: false },
      { id: 89, name: "LF31 E-BUS – BEBs – Interior", selected: false },
      { id: 90, name: "XE40 eBus - Driver's Area", selected: false },
      { id: 91, name: "ElDorado - MODEL/FLOOR PLAN", selected: false },
      { id: 92, name: "ElDorado - MECHANICAL", selected: false },
      { id: 93, name: "ElDorado - ELECTRICAL", selected: false },
      { id: 94, name: "ElDorado - BODY", selected: false },
      { id: 95, name: "ElDorado - HEATING/VENTALATION/AIR", selected: false },
      { id: 96, name: "ElDorado - SAFETY/ANCILLARY", selected: false },
      { id: 97, name: "ElDorado - SEATING", selected: false },
      { id: 98, name: "ElDorado - WATER TEST", selected: false },
      { id: 99, name: "ElDorado - ROAD TEST", selected: false },
      { id: 100, name: "NG40 - UNDERSIDE COACH", selected: false },
      { id: 101, name: "NG40 - DRIVERS COMPARTMENT", selected: false },
      { id: 102, name: "NG40 - WHEEL CHAIR", selected: false },
      { id: 103, name: "NG40 - PASSENGER SIGNAL", selected: false },
      { id: 104, name: "NG40 - BODY INTERIOR/ELECTRICAL", selected: false },
      { id: 105, name: "NG40 - DOORS", selected: false },
      { id: 106, name: "NG40 - CNG Fuel SYSTEM", selected: false },
      { id: 107, name: "NG40 - ENGINE COMPARTMENT", selected: false },
      { id: 108, name: "NG40 - BODY EXTERIOR", selected: false },
      { id: 109, name: "NG40 - ROAD TEST", selected: false },
      { id: 110, name: "NG40 - Other notes (in addition to those noted earlier)", selected: false },
      { id: 111, name: "TOK - INTERIOR", selected: false },
      { id: 112, name: "TOK - UNDERCARIAGE", selected: false },
      { id: 113, name: "TOK - EXTERIOR", selected: false },
      { id: 114, name: "TOK - INTERIOR - INTERIOR/EXTERIOR", selected: false },
      { id: 115, name: "12M CNG - Vehicle Interior", selected: false },
      { id: 116, name: "12M CNG - Vehicle Exterior", selected: false },
      { id: 117, name: "12M CNG - Vehicle Understructure", selected: false },
      { id: 118, name: "12M CNG - Water Leak Test", selected: false },
      { id: 119, name: "12M CNG - Road Test", selected: false },
      { id: 120, name: "12M CNG - CNG Fuel System", selected: false },
      { id: 121, name: "12M CNG - Engine Compartment", selected: false },
      { id: 122, name: "12M CNG - Other Options", selected: false },
      { id: 123, name: "TAM Vero Series E12 - BEBs MOTOR COMPARTMENT", selected: false },
      { id: 124, name: "TAM Vero Series E12 - BEBs BODY EXTERIOR", selected: false },
      { id: 125, name: "TAM Vero Series E12 - BEBs PASSENGER SIGNAL", selected: false },
      { id: 126, name: "TAM Vero Series E12 - BEBs DRIVERS COMPARTMENT", selected: false },
      { id: 127, name: "TAM Vero Series E12 - BEBs BODY INTERIOR", selected: false },
      { id: 128, name: "TAM Vero Series E12 - BEBs WHEEL CHAIR", selected: false },
      { id: 129, name: "TAM Vero Series E12 - BEBs DOORS", selected: false },
      { id: 130, name: "TAM Vero Series E12 - BEBs BRAKES & AIR", selected: false },
      { id: 131, name: "TAM Vero Series E12 - BEBs UNDERSIDE COACH", selected: false },
      { id: 132, name: "TAM Vero Series E12 - BEBs HIGH VOLAGE SYSTEM", selected: false },
      { id: 133, name: "TAM Vero Series E12 - BEBs - ROAD TEST", selected: false },
      { id: 134, name: "TAM Vero Series E12 - BEBs - Water Test", selected: false },
      { id: 135, name: "TAM Vero Series E12 – BEBs – Interior", selected: false },
      { id: 136, name: "TAM Vero Series E12 – Passenger Signals", selected: false },
      { id: 137, name: "TAM Vero Series E12 – BEBs – Exterior", selected: false },
      { id: 138, name: "TAM Vero Series E12 – BEBs – Doors", selected: false },
      { id: 139, name: "TAM Vero Series E12 – BEBs – Mobility Aid (Ramp and Accommodations)", selected: false },
      { id: 140, name: "TAM Vero Series E12 – BEBs – Other Bus Specifications", selected: false },
      { id: 141, name: "TAM Vero Series E12 – BEBs – Underside Coach", selected: false },
      { id: 142, name: "TAM Vero Series E12 – BEBs – Motor/Battery Compartment", selected: false },
      { id: 143, name: "TAM Vero Series E12 – BEBs – High Voltage System", selected: false },
      { id: 144, name: "TS45 - Undercarriage", selected: false },
      { id: 145, name: "NEW ELECTRIC - Driver's Area", selected: false },
      { id: 146, name: "RAM - Undercarriage", selected: false },
      { id: 147, name: "- Diesel - Driver's Area", selected: false },
      { id: 148, name: "NEW HYBRID- ENGINE AREA", selected: false },
      { id: 149, name: "NEW HYBRID- VEHICLE UNDER STRUCTURE", selected: false },
      { id: 150, name: "NEW HYBRID- VEHICLE EXTERIOR", selected: false },
      { id: 151, name: "NEW HYBRID- HYBRID PROPULSION", selected: false },
      { id: 152, name: "NEW HYBRID- VEHICLE TEST DRIVE", selected: false },
      { id: 153, name: "NEW HYBRID- VEHICLE INTERIOR", selected: false },
      { id: 154, name: "NEW ELECTRIC- REAR COMPARTMENT AREA", selected: false },
      { id: 155, name: "NEW ELECTRIC- VEHICLE UNDERSTRUCTURE", selected: false },
      { id: 156, name: "NEW ELECTRIC- VEHICLE EXRTERIOR", selected: false },
      { id: 157, name: "NEW ELECTRIC- VEHICLE INTERIOR", selected: false },
      { id: 158, name: "NEW ELECTRIC- ROOF AREA", selected: false },
      { id: 159, name: "NEW ELECTRIC- VEHICLE TEST DRIVE", selected: false },
      { id: 160, name: "NEW DIESEL VEHICLE- INTERIOR", selected: false },
      { id: 161, name: "NEW DIESEL VEHICLE- EXTERIOR", selected: false },
      { id: 162, name: "NEW DIESEL VEHICLE- VEHICLE UNDERSTRUCTRE", selected: false },
      { id: 163, name: "NEW DIESEL VEHICLE- ENGINE COMPARTMENT", selected: false },
      { id: 164, name: "NEW DIESEL VEHICLE- OTHER OPTIONS", selected: false },
      { id: 165, name: "NEW DIESEL VEHICLE- WATER LEAK TEST", selected: false },
      { id: 166, name: "NEW DIESEL VEHICLE- ROAD TEST", selected: false },
      { id: 167, name: "Rear, Curb, Street High Voltage and Equipment Compartments", selected: false },
      { id: 168, name: "Understructure", selected: false },
      { id: 169, name: "Exterior", selected: false },
      { id: 170, name: "Interior", selected: false },
      { id: 171, name: "Roof", selected: false },
      { id: 172, name: "Road Test (Re-road until all issues have been resolved)", selected: false },
      { id: 173, name: "Water test (Re-water until all issues have been resolved)", selected: false },
      { id: 174, name: "Functional Testing", selected: false },
      { id: 175, name: "Engine Compartment", selected: false },
      { id: 176, name: "Underbody - Front Axle & Suspension", selected: false },
      { id: 177, name: "E-BUS - BEBs BODY EXTERIOR", selected: false },
      { id: 178, name: "YRT - Bus Garage - INTERIOR", selected: false },
      { id: 179, name: "LF31 E-BUS – BEBs – Passenger Signals", selected: false },
      { id: 180, name: "XE40 eBus - Wheelchair Ramp and Accessible Features", selected: false },
      { id: 181, name: "NEW ELECTRIC - Vehicle Interior", selected: false },
      { id: 182, name: "RAM - Exterior", selected: false },
      { id: 183, name: "- Diesel - Entrance Door Ramp & PMD Securement Accessories", selected: false },
      { id: 184, name: "Underbody - Drive Axle & Suspension", selected: false },
      { id: 185, name: "E-BUS - BEBs PASSENGER SIGNAL", selected: false },
      { id: 186, name: "YRT - Bus Garage - EXTERIOR", selected: false },
      { id: 187, name: "LF31 E-BUS – BEBs – Exterior", selected: false },
      { id: 188, name: "XE40 eBus - Vehicle Interior", selected: false },
      { id: 189, name: "NEW ELECTRIC - Wheelchair Ramp and Accessible Features", selected: false },
      { id: 190, name: "RAM - Engine Compartment", selected: false },
      { id: 191, name: "- Diesel - Interior", selected: false },
      { id: 192, name: "Underbody - Tag Axle & Suspension", selected: false },
      { id: 193, name: "E-BUS - BEBs DRIVERS COMPARTMENT", selected: false },
      { id: 194, name: "YRT - Bus Garage - OTHER", selected: false },
      { id: 195, name: "LF31 E-BUS – BEBs – Door", selected: false },
      { id: 196, name: "XE40 eBus - Vehicle Exterior", selected: false },
      { id: 197, name: "NEW ELECTRIC - Vehicle Exterior", selected: false },
      { id: 198, name: "RAM - Interior", selected: false },
      { id: 199, name: "Underbody - Brake System", selected: false },
      { id: 200, name: "E-BUS - BEBs BODY INTERIOR", selected: false },
      { id: 201, name: "YRT - Bus Garage - FREON", selected: false },
      { id: 202, name: "LF31 E-BUS – BEBs – Mobility Aid (Ramp and Accommodations)", selected: false },
      { id: 203, name: "XE40 eBus - Rear ESS Compartment", selected: false },
      { id: 204, name: "NEW ELECTRIC - Rear ESS Compartment", selected: false },
      { id: 205, name: "RAM - Driver's Area", selected: false },
      { id: 206, name: "- Diesel - Exterior", selected: false },
      { id: 207, name: "Underbody - Corrosion Protection", selected: false },
      { id: 208, name: "E-BUS - BEBs WHEEL CHAIR", selected: false },
      { id: 209, name: "LF31 E-BUS – BEBs – Other Bus Specifications", selected: false },
      { id: 210, name: "XE40 eBus - Vehicle Understructure", selected: false },
      { id: 211, name: "NEW ELECTRIC - Vehicle Understructure", selected: false },
      { id: 212, name: "RAM - Water Test", selected: false },
      { id: 213, name: "- Diesel - Engine Compartment", selected: false },
      { id: 214, name: "Interior - Driver & Entrance Area", selected: false },
      { id: 215, name: "E-BUS - BEBs DOORS", selected: false },
      { id: 216, name: "LF31 E-BUS – BEBs – Underside Coach", selected: false },
      { id: 217, name: "XE40 eBus - Road Test", selected: false },
      { id: 218, name: "NEW ELECTRIC - Road Test", selected: false },
      { id: 219, name: "RAM - Road Test", selected: false },
      { id: 220, name: "- Diesel - Under Structure", selected: false },
      { id: 221, name: "Interior - Entrance Door", selected: false },
      { id: 222, name: "E-BUS - BEBs BRAKES & AIR", selected: false },
      { id: 223, name: "LF31 E-BUS – BEBs – Motor/Battery Compartment", selected: false },
      { id: 224, name: "XE40 eBus - Water Leak Test", selected: false },
      { id: 225, name: "NEW ELECTRIC - Water Leak Test", selected: false },
      { id: 226, name: "- Diesel - Water Leak Test", selected: false },
      { id: 227, name: "Interior - Passenger Compartment", selected: false },
      { id: 228, name: "E-BUS - BEBs UNDERSIDE COACH", selected: false },
      { id: 229, name: "LF31 E-BUS – BEBs – High Voltage System", selected: false },
      { id: 230, name: "- Diesel - Road Test", selected: false },
      { id: 231, name: "Engine Compartment - Fire Suppresion System", selected: false },
      { id: 232, name: "E-BUS - BEBs HIGH VOLAGE SYSTEM", selected: false },
      { id: 233, name: "LF31 E-BUS – BEBs – Brakes & Air", selected: false },
      { id: 234, name: "Engine Compartment - Engine Compartment", selected: false },
      { id: 235, name: "LF31 E-BUS – BEBs – Chargers", selected: false },
      { id: 236, name: "LF31 E-BUS – BEBs – Test Drive", selected: false },
      { id: 237, name: "Engine Compartment - Cooling & HVAC Systems", selected: false },
      { id: 238, name: "LF31 E-BUS – BEBs – Chargers", selected: false },
      { id: 239, name: "Exterior - Front", selected: false },
      { id: 240, name: "Exterior - Left (Driver side)", selected: false },
      { id: 241, name: "Exterior - Right (Curb side)", selected: false },
      { id: 242, name: "Exterior - Rear", selected: false },
      { id: 243, name: "Rear", selected: false },
    ];
  }

  ngOnInit(): void {
    this.projectForm = this.formBuilder.group({
      projectName: ['', Validators.required],
      client: ['', Validators.required],
      assessmentType: ['', Validators.required],
      startLocation: ['', Validators.required],
      endLocation: ['', Validators.required],
      manufacturer: ['', Validators.required],
      description: ['']
    });

    if (!this.canManageProjects) {
      this.onCancel();
    }

    forkJoin({
      clients: this.clientService.getClients().pipe(catchError(() => of([] as Client[]))),
      locations: this.locationService.getAllLocations().pipe(catchError(() => of([] as ApiLocation[]))),
      manufacturers: this.userManagementService.getManufacturers(0).pipe(catchError(() => of([] as ManufacturerOption[]))),
    }).subscribe(({ clients, locations, manufacturers }) => {
      this.clients = clients;
      this.locations = locations;
      this.manufacturers = manufacturers;
    });
  }

  toggleSelectAll(checked: boolean): void {
    this.inspectionCategories.forEach(c => c.selected = checked);
  }

  get f() {
    return this.projectForm.controls;
  }

  onSubmit(): void {
    this.submitted = true;
    if (this.projectForm.invalid || !this.canManageProjects) return;
    console.log('Project Data:', this.projectForm.value);
    console.log('Selected Categories:', this.inspectionCategories.filter(c => c.selected).map(c => c.id));
    this.router.navigate([`${this.portalPrefix}/projects/list`]);
  }

  setTab(key: string): void {
    this.activeTab = key;
  }

  onCancel(): void {
    this.router.navigate([`${this.portalPrefix}/projects/list`]);
  }
}
