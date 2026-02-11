import pandas as pd
import json
import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "public" / "assets" / "data"

excel_path = r"c:\Users\Owner\Downloads\Complete_Bus_Manufacturer_Facilities_FULL.xlsx"
factories_json_path = DATA_DIR / "factories.json"
output_new_json_path = DATA_DIR / "manufacturer-facilities.json"

# Synonyms mapping to unify manufacturers
SYNONYMS = {
    "nova bus": "nova",
    "arboc specialty vehicles": "arboc",
    "nfi / arboc": "arboc",
    "eldorado national": "enc (eldorado national)",
    "enc": "enc (eldorado national)"
}

def process_data():
    # Load Excel
    df = pd.read_excel(excel_path)
    
    # Load existing factories.json (ORIGINAL version before my first failed-ish run)
    # Actually, I'll just manually define the base manufacturers to be safe and clean.
    initial_manufacturers = [
        {"manufacturer_id": 1, "manufacturer_name": "Nova"},
        {"manufacturer_id": 2, "manufacturer_name": "New Flyer"},
        {"manufacturer_id": 3, "manufacturer_name": "Arboc"},
        {"manufacturer_id": 4, "manufacturer_name": "TAM"}
    ]
    
    # Original factories (from the very first view_file)
    initial_factories = [
        {"factory_id": 1, "manufacturer_id": 1, "factory_location_name": "St. Eustache (Nova)", "city": "St. Eustache", "state_province": "Quebec", "country": "Canada"},
        {"factory_id": 2, "manufacturer_id": 2, "factory_location_name": "Crookston (New Flyer)", "city": "Crookston", "state_province": "Minnesota", "country": "USA"},
        {"factory_id": 3, "manufacturer_id": 2, "factory_location_name": "Winnipeg (New Flyer)", "city": "Winnipeg", "state_province": "Manitoba", "country": "Canada"},
        {"factory_id": 4, "manufacturer_id": 3, "factory_location_name": "Middlebury IN (NFI / Arboc)", "city": "Middlebury", "state_province": "Indiana", "country": "USA"},
        {"factory_id": 7, "manufacturer_id": 4, "factory_location_name": "TAM Facility", "city": None, "state_province": None, "country": "China"}
    ]
    
    manufacturers = initial_manufacturers
    factories = initial_factories
    
    # Mapping for lookups
    m_name_to_id = {m['manufacturer_name'].lower(): m['manufacturer_id'] for m in manufacturers}
    
    def get_m_id(name):
        name_clean = str(name).strip().lower()
        # Resolve synonyms
        resolved_name = SYNONYMS.get(name_clean, name_clean)
        
        if resolved_name in m_name_to_id:
            return m_name_to_id[resolved_name]
        
        # New manufacturer
        new_id = max([m['manufacturer_id'] for m in manufacturers]) + 1
        manufacturers.append({
            "manufacturer_id": new_id,
            "manufacturer_name": str(name).strip()
        })
        m_name_to_id[resolved_name] = new_id
        return new_id

    new_factories = []
    consolidated_data = []
    
    # Track existing factory names to avoid duplicates if Excel repeats them
    # Format: (m_id, location_name.lower())
    existing_factories_set = set([(f['manufacturer_id'], f['factory_location_name'].lower()) for f in factories])
    
    max_f_id = max([f['factory_id'] for f in factories])

    for index, row in df.iterrows():
        company_name = str(row['Company']).strip()
        m_id = get_m_id(company_name)
        
        facility_type = str(row['Facility Type']) if pd.notna(row['Facility Type']) else ""
        city = str(row['City']) if pd.notna(row['City']) else ""
        location_name = f"{city} ({company_name})" if city else f"{facility_type} ({company_name})"
        
        factory_key = (m_id, location_name.lower())
        
        if factory_key not in existing_factories_set:
            max_f_id += 1
            f_id = max_f_id
            
            factory_entry = {
                "factory_id": f_id,
                "manufacturer_id": m_id,
                "factory_location_name": location_name,
                "city": city if pd.notna(row['City']) else None,
                "state_province": str(row['State/Province']) if pd.notna(row['State/Province']) else None,
                "country": str(row['Country']) if pd.notna(row['Country']) else None
            }
            factories.append(factory_entry)
            existing_factories_set.add(factory_key)
        else:
            # Find existing f_id for consolidated data
            f_id = next(f['factory_id'] for f in factories if f['manufacturer_id'] == m_id and f['factory_location_name'].lower() == location_name.lower())

        # For consolidated data
        consolidated_entry = row.to_dict()
        consolidated_entry['manufacturer_id'] = m_id
        consolidated_entry['factory_id'] = f_id
        # Convert NaN to None for JSON
        for k, v in consolidated_entry.items():
            if pd.isna(v):
                consolidated_entry[k] = None
        consolidated_data.append(consolidated_entry)

    updated_factories_data = {
        "manufacturers": manufacturers,
        "factories": factories
    }
    
    # Write updated factories.json
    with open(factories_json_path, 'w') as f:
        json.dump(updated_factories_data, f, indent=2)
    
    # Write new consolidated json
    with open(output_new_json_path, 'w') as f:
        json.dump(consolidated_data, f, indent=2)
        
    print(f"Successfully processed {len(factories)} total factories.")
    print(f"Updated {factories_json_path}")
    print(f"Created {output_new_json_path}")

if __name__ == "__main__":
    process_data()
