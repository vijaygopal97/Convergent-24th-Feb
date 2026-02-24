#!/usr/bin/env python3
import pandas as pd
import json
import sys

excel_path = sys.argv[1]

# Read Excel file
df = pd.read_excel(excel_path)

# Convert to JSON
data = df.to_dict('records')

# Output as JSON
print(json.dumps(data))

























































