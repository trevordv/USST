import pandas as pd
import re
import json

# Load all three files
pv = pd.read_csv('attached_assets/PVH_Contacts_1781411207523.CSV', encoding='utf-8-sig')
sea = pd.read_excel('attached_assets/energySEA_Contacts_1781411207522.xlsx')
trev = pd.read_excel('attached_assets/Trevor_contacts_list-Australia_1781411207522.xlsx')

# Build unified contacts
contacts = []

# PVH: columns are Title,First Name,Middle Name,Last Name,Suffix,Company,E-mail Address,E-mail Type,E-mail Display Name
for _, row in pv.iterrows():
    first = str(row['First Name']) if pd.notna(row['First Name']) else ''
    last = str(row['Last Name']) if pd.notna(row['Last Name']) else ''
    name = ' '.join([p for p in [first, last] if p]).strip()
    company = str(row['Company']).strip() if pd.notna(row['Company']) else ''
    email = str(row['E-mail Address']).strip().lower() if pd.notna(row['E-mail Address']) else ''
    if email and '@' in email:
        contacts.append({'name': name, 'company': company, 'email': email, 'source': 'PVH'})

# energySEA: columns are No.,Name,Company Name,Contact Business Relation,Phone No.,Email,Salesperson Code,Territory Code,State,Coupled to Dataverse
for _, row in sea.iterrows():
    name = str(row['Name']).strip() if pd.notna(row['Name']) else ''
    company = str(row['Company Name']).strip() if pd.notna(row['Company Name']) else ''
    email = str(row['Email']).strip().lower() if pd.notna(row['Email']) else ''
    phone = str(row['Phone No.']).strip() if pd.notna(row['Phone No.']) else ''
    if email and '@' in email:
        contacts.append({'name': name, 'company': company, 'email': email, 'phone': phone, 'source': 'energySEA'})

# Trevor: columns are Name,Company Name,Segment,Phone No.,Email,State,Title
for _, row in trev.iterrows():
    name = str(row['Name']).strip() if pd.notna(row['Name']) else ''
    company = str(row['Company Name']).strip() if pd.notna(row['Company Name']) else ''
    email = str(row['Email']).strip().lower() if pd.notna(row['Email']) else ''
    phone = str(row['Phone No.']).strip() if pd.notna(row['Phone No.']) else ''
    if email and '@' in email:
        contacts.append({'name': name, 'company': company, 'email': email, 'phone': phone, 'source': 'Trevor'})

# Remove duplicates (same email)
seen_emails = set()
unique_contacts = []
for c in contacts:
    if c['email'] not in seen_emails:
        seen_emails.add(c['email'])
        unique_contacts.append(c)

print(f"Total contacts: {len(contacts)}")
print(f"Unique contacts: {len(unique_contacts)}")

# Save unified contacts
with open('/tmp/unified_contacts.json', 'w') as f:
    json.dump(unique_contacts, f, indent=2)

# Build company -> contacts map
company_map = {}
for c in unique_contacts:
    company = c['company']
    if not company:
        continue
    if company not in company_map:
        company_map[company] = []
    company_map[company].append(c)

# Save company map
with open('/tmp/company_map.json', 'w') as f:
    json.dump(company_map, f, indent=2)

# Normalize company names

def normalize_company(name):
    if not name:
        return ''
    n = name.lower()
    # Remove common suffixes
    n = re.sub(r'\s+pty\s+ltd\.?\s*$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+ltd\.?\s*$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+limited\s*$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+pty\s*$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+group\s*$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+australia\s*$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+holdings\s*$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+corporation\s*$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+inc\.?\s*$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+llc\s*$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+co\.?\s*$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+company\s*$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+international\s*$', '', n, flags=re.IGNORECASE)
    # Remove punctuation and spaces
    n = re.sub(r'[^a-z0-9]', '', n)
    return n

# Build normalized company map
norm_map = {}
for company, contact_list in company_map.items():
    norm = normalize_company(company)
    if norm:
        if norm not in norm_map:
            norm_map[norm] = []
        norm_map[norm].extend(contact_list)

# Save normalized map
with open('/tmp/norm_map.json', 'w') as f:
    json.dump(norm_map, f, indent=2)

# Get unique companies
unique_companies = sorted(company_map.keys())
print(f"\nUnique companies: {len(unique_companies)}")
print("\nFirst 50 companies:")
for c in unique_companies[:50]:
    print(f"  {c}")
