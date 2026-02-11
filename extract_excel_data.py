import pandas as pd
import json
import sys

try:
    file_path = r"c:\Users\Owner\Downloads\Complete_Bus_Manufacturer_Facilities_FULL.xlsx"
    df = pd.read_excel(file_path)
    # Convert dataframe to a list of dictionaries
    data = df.to_dict(orient='records')
    print(json.dumps(data, indent=2))
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
