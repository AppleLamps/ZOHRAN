import csv
import json
import os

# SETTINGS
CSV_FILE = r'C:\Users\lucas\Desktop\websitez\ZohranKMamdani_X_posts.csv'
USERNAME = 'ZohranKMamdani'
OUTPUT_FILE = CSV_FILE.replace('.csv', '.json')
BASE_URL = f"https://x.com/{USERNAME}/status/"

def find_post_id(row):
    for key in row.keys():
        if 'id' in key.lower():
            val = row[key].strip().strip("'\"")  # Remove quotes and whitespace
            if val.isdigit():
                return val
    return None

def main():
    if os.path.exists(OUTPUT_FILE):
        print(f"Warning: Output file {OUTPUT_FILE} already exists and will be overwritten.")

    posts = []
    with open(CSV_FILE, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            post_id = find_post_id(row)
            if not post_id:
                print(f"Skipping row with missing or invalid post_id: {row}")
                continue
            row['link'] = BASE_URL + post_id
            posts.append(row)

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as out:
        json.dump(posts, out, ensure_ascii=False, indent=2)

    print(f"Converted {len(posts)} posts to {OUTPUT_FILE}")

if __name__ == '__main__':
    main()
