#!/usr/bin/env python3
"""
Script to update survey responses from Excel file
Processes both CATI and CAPI sheets
"""
import os
import sys
from datetime import datetime
import pandas as pd
from pymongo import MongoClient
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))

# Configuration
EXCEL_FILE_PATH = '/var/www/reports/Vijay_CAPI & CATI_Server IDs for valid and Reject_5th Feb (1).xlsx'
REVIEWER_EMAIL = 'ajayadarsh@gmail.com'
REJECTION_REASON = 'Manual Rejection on 6 feb 2026'

def main():
    # Connect to MongoDB
    mongodb_uri = os.getenv('MONGODB_URI')
    if not mongodb_uri:
        print('❌ MONGODB_URI not found in environment variables')
        sys.exit(1)
    
    client = MongoClient(mongodb_uri)
    db = client.get_database()
    survey_responses = db.surveyresponses
    users = db.users
    
    print('✅ Connected to MongoDB')
    
    # Find the reviewer user
    reviewer = users.find_one({'email': REVIEWER_EMAIL})
    if not reviewer:
        print(f'❌ Reviewer not found: {REVIEWER_EMAIL}')
        sys.exit(1)
    
    reviewer_id = reviewer['_id']
    print(f'✅ Found reviewer: {REVIEWER_EMAIL} (ID: {reviewer_id})')
    
    # Load Excel file
    try:
        xls = pd.ExcelFile(EXCEL_FILE_PATH)
        print('✅ Loaded Excel file')
        print(f'   Sheets: {xls.sheet_names}')
    except Exception as e:
        print(f'❌ Error loading Excel file: {e}')
        sys.exit(1)
    
    sheets = ['CATI', 'CAPI']
    total_stats = {
        'processed': 0,
        'approved': 0,
        'rejected': 0,
        'not_found': 0,
        'errors': 0
    }
    not_found_ids = []
    error_ids = []
    
    for sheet_name in sheets:
        print(f'\n📊 Processing sheet: {sheet_name}')
        
        try:
            df = pd.read_excel(xls, sheet_name=sheet_name)
        except Exception as e:
            print(f'⚠️  Error reading sheet {sheet_name}: {e}')
            continue
        
        # Find column names (handle case variations)
        response_id_col = None
        status_col = None
        
        for col in df.columns:
            col_lower = str(col).lower().strip()
            if 'response' in col_lower and 'id' in col_lower:
                response_id_col = col
            if 'revised' in col_lower and 'status' in col_lower:
                status_col = col
        
        if not response_id_col or not status_col:
            print(f'⚠️  Could not find required columns in sheet {sheet_name}')
            print(f'   Available columns: {list(df.columns)}')
            continue
        
        print(f'   Found columns: Response ID = "{response_id_col}", Status = "{status_col}"')
        print(f'   Total rows: {len(df)}')
        
        sheet_stats = {
            'processed': 0,
            'approved': 0,
            'rejected': 0,
            'not_found': 0,
            'errors': 0
        }
        
        # Process each row
        for idx, row in df.iterrows():
            response_id = str(row[response_id_col]).strip() if pd.notna(row[response_id_col]) else None
            status = str(row[status_col]).strip() if pd.notna(row[status_col]) else None
            
            if not response_id or not status or response_id == 'nan' or status == 'nan':
                continue  # Skip empty rows
            
            # Normalize status
            status_lower = status.lower()
            if status_lower not in ['approved', 'rejected']:
                print(f'⚠️  Invalid status "{status}" for response {response_id}, skipping...')
                continue
            
            try:
                # Find the response
                response = survey_responses.find_one({'responseId': response_id})
                
                if not response:
                    print(f'❌ Response not found: {response_id}')
                    not_found_ids.append(response_id)
                    sheet_stats['not_found'] += 1
                    total_stats['not_found'] += 1
                    continue
                
                # Prepare update data
                new_status = 'Approved' if status_lower == 'approved' else 'Rejected'
                
                update_data = {
                    '$set': {
                        'status': new_status,
                        'verificationData.reviewer': reviewer_id,
                        'verificationData.reviewedAt': datetime.utcnow(),
                        'updatedAt': datetime.utcnow()
                    },
                    '$unset': {
                        'reviewAssignment': ''
                    }
                }
                
                # Add rejection reason if rejected
                if status_lower == 'rejected':
                    update_data['$set']['verificationData.feedback'] = REJECTION_REASON
                else:
                    # For approved, preserve existing feedback or set empty
                    if 'verificationData' in response and 'feedback' in response.get('verificationData', {}):
                        # Keep existing feedback
                        pass
                    else:
                        update_data['$set']['verificationData.feedback'] = ''
                
                # Preserve existing verification criteria if they exist
                if 'verificationData' in response and 'criteria' in response.get('verificationData', {}):
                    update_data['$set']['verificationData.criteria'] = response['verificationData']['criteria']
                
                # Update the response
                result = survey_responses.update_one(
                    {'_id': response['_id']},
                    update_data
                )
                
                if result.modified_count > 0 or result.matched_count > 0:
                    if status_lower == 'approved':
                        sheet_stats['approved'] += 1
                        total_stats['approved'] += 1
                    else:
                        sheet_stats['rejected'] += 1
                        total_stats['rejected'] += 1
                    
                    sheet_stats['processed'] += 1
                    total_stats['processed'] += 1
                    
                    if sheet_stats['processed'] % 100 == 0:
                        print(f'   Processed {sheet_stats["processed"]} responses...')
                else:
                    print(f'❌ Failed to update response: {response_id}')
                    error_ids.append(response_id)
                    sheet_stats['errors'] += 1
                    total_stats['errors'] += 1
                    
            except Exception as error:
                print(f'❌ Error processing response {response_id}: {str(error)}')
                error_ids.append(response_id)
                sheet_stats['errors'] += 1
                total_stats['errors'] += 1
        
        print(f'\n✅ Sheet {sheet_name} completed:')
        print(f'   Total processed: {sheet_stats["processed"]}')
        print(f'   Approved: {sheet_stats["approved"]}')
        print(f'   Rejected: {sheet_stats["rejected"]}')
        print(f'   Not found: {sheet_stats["not_found"]}')
        print(f'   Errors: {sheet_stats["errors"]}')
    
    print(f'\n📊 ===== FINAL SUMMARY =====')
    print(f'Total processed: {total_stats["processed"]}')
    print(f'Total approved: {total_stats["approved"]}')
    print(f'Total rejected: {total_stats["rejected"]}')
    print(f'Total not found: {total_stats["not_found"]}')
    print(f'Total errors: {total_stats["errors"]}')
    
    if not_found_ids:
        print(f'\n⚠️  Not found response IDs (first 20):')
        print(', '.join(not_found_ids[:20]))
        if len(not_found_ids) > 20:
            print(f'   ... and {len(not_found_ids) - 20} more')
    
    if error_ids:
        print(f'\n⚠️  Error response IDs (first 20):')
        print(', '.join(error_ids[:20]))
        if len(error_ids) > 20:
            print(f'   ... and {len(error_ids) - 20} more')
    
    client.close()
    print('\n✅ Script completed successfully')

if __name__ == '__main__':
    main()






