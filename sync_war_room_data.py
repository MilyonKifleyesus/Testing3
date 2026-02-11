import json
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / 'public' / 'assets' / 'data'

factories_path = DATA_DIR / 'factories.json'
war_room_data_path = DATA_DIR / 'fluorescence-map-data.json'

with open(factories_path, 'r', encoding='utf-8') as f:
    factories_data = json.load(f)

with open(war_room_data_path, 'r', encoding='utf-8') as f:
    war_room_data = json.load(f)

# Comprehensive Coordinate Map (Researched for all 46 sites)
coordinate_map = {
    # Canada
    "winnipeg": {"latitude": 49.8971, "longitude": -97.0271},
    "saint-eustache": {"latitude": 45.5488, "longitude": -73.9201},
    "saint-françois-du-lac": {"latitude": 46.0523, "longitude": -72.8280},
    "saint-francois-du-lac": {"latitude": 46.0523, "longitude": -72.8280},
    "montréal": {"latitude": 45.5786, "longitude": -73.5414},
    "montreal": {"latitude": 45.5786, "longitude": -73.5414},
    "sainte-claire": {"latitude": 46.5985, "longitude": -70.8685},
    "lévis": {"latitude": 46.7581, "longitude": -71.2403},
    "levis": {"latitude": 46.7581, "longitude": -71.2403},
    "airdrie": {"latitude": 51.2917, "longitude": -114.0142},
    "richmond": {"latitude": 49.1667, "longitude": -123.1333},
    "mississauga": {"latitude": 43.5890, "longitude": -79.6441},
    "arnprior": {"latitude": 45.4327, "longitude": -76.3549},
    
    # USA
    "crookston": {"latitude": 47.7712, "longitude": -96.6023},
    "st. cloud": {"latitude": 45.4677, "longitude": -94.1198},
    "anniston": {"latitude": 33.6063, "longitude": -85.8459},
    "jamestown": {"latitude": 42.1010, "longitude": -79.2070},
    "shepherdsville": {"latitude": 38.0000, "longitude": -85.7000},
    "pembina": {"latitude": 48.9669, "longitude": -97.2454},
    "plattsburgh": {"latitude": 44.6995, "longitude": -73.4529},
    "middlebury": {"latitude": 41.6739, "longitude": -85.7067},
    "blackwood": {"latitude": 39.7578, "longitude": -75.0503},
    "torrance": {"latitude": 33.8358, "longitude": -118.3406},
    "hayward": {"latitude": 37.6688, "longitude": -122.0808},
    "des plaines": {"latitude": 42.0335, "longitude": -87.8845},
    "dallas": {"latitude": 32.7767, "longitude": -96.7970},
    "newark": {"latitude": 37.5255, "longitude": -122.0355},
    "franklin park": {"latitude": 41.9361, "longitude": -87.8761},
    "south plainfield": {"latitude": 40.5793, "longitude": -74.4115},
    "secaucus": {"latitude": 40.7896, "longitude": -74.0565},
    "goodlettsville": {"latitude": 36.3231, "longitude": -86.7133},
    "fort worth": {"latitude": 32.7555, "longitude": -97.3308},
    "houston": {"latitude": 29.7604, "longitude": -95.3698},
    "jacksonville": {"latitude": 30.3322, "longitude": -81.6557},
    "winter garden": {"latitude": 28.4070, "longitude": -81.3061},
    "riverside": {"latitude": 33.9533, "longitude": -117.3961},
    "burlingame": {"latitude": 37.5960, "longitude": -122.3707},
    "orlando": {"latitude": 28.4070, "longitude": -81.3061},
    
    # Global
    "maribor": {"latitude": 46.5274, "longitude": 15.6667},
    "nilufer": {"latitude": 40.2311, "longitude": 28.9328},
    "nil\u00fcfer": {"latitude": 40.2311, "longitude": 28.9328},
    "adana": {"latitude": 36.9923, "longitude": 35.1876},
    "istanbul": {"latitude": 41.0119, "longitude": 29.0269},
    "china": {"latitude": 35.0000, "longitude": 105.0000}, # General if specific city missing
}

# Manufacturer Mapping
manufacturer_id_map = {
    1: "nova",
    2: "new-flyer",
    3: "arboc",
    4: "tam",
    5: "mci",
    6: "prevost",
    7: "enc",
    8: "karsan",
    9: "temsa"
}

# Subsidiary Defaults
subsidiary_defaults = {
    "nova": {"name": "Nova Bus", "logo": "/assets/images/Nova-Bus.png", "description": "High-capacity urban transit manufacturing."},
    "new-flyer": {"name": "New Flyer Industries", "logo": "/assets/images/New-Flyer.jpg", "description": "Zero-emission bus manufacturing and retrofits."},
    "arboc": {"name": "Arboc Specialty Vehicles", "logo": "/assets/images/NFI_Logo.png", "description": "Low-floor cutaway bus manufacturing."},
    "tam": {"name": "TAM", "logo": "/assets/images/svgs/user.svg", "description": "European bus and coach manufacturing."},
    "mci": {"name": "MCI (Motor Coach Industries)", "logo": "/assets/images/MCI_Logo.png", "description": "Premium motorcoach manufacturing."},
    "prevost": {"name": "Prevost", "logo": "/assets/images/Prevost_Logo.png", "description": "Luxury coach and motor caravan manufacturing."},
    "enc": {"name": "ENC", "logo": "/assets/images/svgs/user.svg", "description": "Specialized transit bus manufacturing."},
    "karsan": {"name": "Karsan", "logo": "/assets/images/KARSAN.jpg", "description": "European electric bus production."},
    "temsa": {"name": "TEMSA", "logo": "/assets/images/TEMSA_Logo_Black.svg", "description": "Global motorcoach and transit manufacturer."}
}

parent_group = next((g for g in war_room_data['parentGroups'] if g['id'] == 'namg'), None)
if not parent_group: exit("Parent group 'namg' not found")

subsidiaries_map = {s['id']: s for s in parent_group['subsidiaries']}

def clean_key(text):
    if not text: return ""
    return re.sub(r'[^a-zA-Z0-9]', '', str(text).lower().strip())

# Add/Update Subsidiaries
for m_id, s_id in manufacturer_id_map.items():
    if s_id not in subsidiaries_map:
        defaults = subsidiary_defaults.get(s_id, {})
        new_subsidiary = {
            "id": s_id, "parentGroupId": "namg", "name": defaults.get("name", s_id.upper()),
            "status": "ACTIVE", "metrics": {"assetCount": 0, "incidentCount": 0, "syncStability": 95.0},
            "description": defaults.get("description", ""), "location": "", "logo": defaults.get("logo"),
            "quantumChart": {"dataPoints": [50, 60, 55, 70, 65, 80], "highlightedIndex": 5},
            "hubs": [], "factories": []
        }
        parent_group['subsidiaries'].append(new_subsidiary)
        subsidiaries_map[s_id] = new_subsidiary

# Sync Factories
for f_data in factories_data['factories']:
    m_id = f_data.get('manufacturer_id')
    s_id = manufacturer_id_map.get(m_id)
    if not s_id: continue
    
    subsidiary = subsidiaries_map[s_id]
    wr_factories = subsidiary['factories']
    
    f_name = f_data['factory_location_name']
    city = f_data.get('city', '')
    
    # Deduplication/Matching logic
    # Match by cleaned name or city
    match_key = clean_key(f_name)
    city_key = clean_key(city)
    
    existing = None
    for wf in wr_factories:
        wf_name_key = clean_key(wf['name'])
        wf_city_key = clean_key(wf.get('city'))
        if wf_name_key == match_key or (wf_city_key == city_key and city_key):
            existing = wf
            break
            
    # Coordinate lookup
    coords = coordinate_map.get(city.lower().strip(), {"latitude": 0, "longitude": 0})
    if coords['latitude'] == 0:
        for c_key, c_val in coordinate_map.items():
            if c_key in f_name.lower():
                coords = c_val
                break

    if existing:
        factory_obj = existing
    else:
        new_f_id = f"{s_id}-{re.sub(r'[^a-zA-Z0-9]', '-', f_name.lower())}"
        factory_obj = {
            "id": new_f_id, "parentGroupId": "namg", "subsidiaryId": s_id,
            "name": f_name, "city": city or "", "country": f_data.get('country', ''),
            "status": "ACTIVE", "syncStability": 95.0, "assets": 10, "incidents": 0,
            "description": f_data.get('facility_type', 'Manufacturing Facility'),
            "logo": subsidiary.get('logo')
        }
        wr_factories.append(factory_obj)
        
    # Update fields
    factory_obj['fullAddress'] = f_data.get('full_address')
    factory_obj['facilityType'] = f_data.get('facility_type')
    factory_obj['notes'] = f_data.get('notes')
    factory_obj['coordinates'] = coords if coords['latitude'] != 0 else factory_obj.get('coordinates', {"latitude": 0, "longitude": 0})

# Cleanup: Ensure no factory has invalid default coordinates if possible
# Also avoid exact identical coordinates for different factories in same city by adding tiny offset
city_factory_counts = {}
for group in war_room_data['parentGroups']:
    for sub in group['subsidiaries']:
        for fac in sub['factories']:
            c = fac['coordinates']
            key = (c['latitude'], c['longitude'])
            if key == (0, 0): continue
            
            if key in city_factory_counts:
                # Add tiny jitter
                jitter = 0.005 * city_factory_counts[key]
                fac['coordinates']['latitude'] += jitter
                fac['coordinates']['longitude'] += jitter
                city_factory_counts[key] += 1
            else:
                city_factory_counts[key] = 1

with open(war_room_data_path, 'w', encoding='utf-8') as f:
    json.dump(war_room_data, f, indent=2, ensure_ascii=False)

print("Mapping refined. Coordinates updated and jitter added for overlapping sites.")
