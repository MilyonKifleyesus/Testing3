import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "public" / "assets" / "data"

factories_path = DATA_DIR / "factories.json"
mf_path = DATA_DIR / "manufacturer-facilities.json"

def consolidate():
    with open(factories_path, 'r') as f:
        factories_data = json.load(f)
    
    with open(mf_path, 'r') as f:
        mf_list = json.load(f)
    
    # We want to keep the manufacturers from factories.json
    # but enrich the factories array with data from mf_list.
    
    # Mapping for quick lookup from mf_list by factory_id
    mf_map = {item['factory_id']: item for item in mf_list}
    
    new_factories = []
    
    # We'll use the factories from the factories.json as the base for stable IDs
    # But we also need to add any that are in mf_list but not in factories.json
    
    existing_f_ids = set()
    for f in factories_data['factories']:
        f_id = f['factory_id']
        existing_f_ids.add(f_id)
        
        # Enrich if exists in mf_list
        if f_id in mf_map:
            mf_item = mf_map[f_id]
            f['full_address'] = mf_item.get('Full Address')
            f['facility_type'] = mf_item.get('Facility Type')
            f['notes'] = mf_item.get('Notes')
        new_factories.append(f)
        
    # Add any from mf_list that weren't in factories.json
    for f_id, mf_item in mf_map.items():
        if f_id not in existing_f_ids:
            # Construct a record that fits the app's expectations
            company_name = mf_item.get('Company')
            city = mf_item.get('City')
            
            new_f = {
                "factory_id": f_id,
                "manufacturer_id": mf_item.get('manufacturer_id'),
                "factory_location_name": f"{city} ({company_name})" if city else f"{mf_item.get('Facility Type')} ({company_name})",
                "city": city,
                "state_province": mf_item.get('State/Province'),
                "country": mf_item.get('Country'),
                "full_address": mf_item.get('Full Address'),
                "facility_type": mf_item.get('Facility Type'),
                "notes": mf_item.get('Notes')
            }
            new_factories.append(new_f)
            existing_f_ids.add(f_id)

    # Sort by factory_id for cleanliness
    new_factories.sort(key=lambda x: x['factory_id'])
    
    consolidated = {
        "manufacturers": factories_data['manufacturers'],
        "factories": new_factories
    }
    
    with open(factories_path, 'w') as f:
        json.dump(consolidated, f, indent=2)
        
    print(f"Consolidated data into {factories_path}")

if __name__ == "__main__":
    consolidate()
