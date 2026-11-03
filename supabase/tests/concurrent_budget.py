"""Real separate HTTP sessions; uses the locally minted preview session, never logs it.
Creates a clearly labelled fictional workspace and cancels its requests afterwards.
Run: python3 supabase/tests/concurrent_budget.py
"""
import concurrent.futures
import json
import os
import threading
from pathlib import Path

import requests

config = {}
for line in Path('.env').read_text().splitlines():
    if '=' in line:
        key, value = line.split('=', 1)
        config[key] = value.strip('"')
with open(os.path.expanduser('~/.cache/lovable-auth/session.json')) as file:
    token = json.load(file)['session']['access_token']
url = config['VITE_SUPABASE_URL'] + '/rest/v1'
headers = {'apikey': config['VITE_SUPABASE_PUBLISHABLE_KEY'], 'Authorization': 'Bearer ' + token}

def rpc(name, body, session=None):
    client = session or requests.Session()
    return client.post(url + '/rpc/' + name, headers=headers, json=body, timeout=45)

created = rpc('create_organization', {'_name': 'Concurrent budget test — fictional', '_with_demo': True})
assert created.ok, 'Could not create isolated test workspace'
org = created.json()
assert rpc('mark_test_workspace', {'_org': org, '_reason': 'concurrent_budget.py automated test'}).ok
supplier = requests.get(url + '/suppliers', headers=headers, params={'org_id': 'eq.' + org, 'select': 'id'}, timeout=30).json()[0]['id']
ids = []
try:
    for index, amount in enumerate([10000, 10000, 8000, 8000]):
        response = rpc('submit_invoice', {'_org': org, '_supplier': supplier, '_invoice_ref': f'RACE-{index}', '_amount_minor': amount, '_currency': 'CAD', '_recipient': 'DEMO-MERCHANT-HARBOUR-001', '_category': 'office', '_description': 'Concurrent budget fixture', '_contact': None, '_message': None, '_storage_path': None, '_file_name': None, '_listing': None, '_quantity': None})
        assert response.ok, 'Test invoice setup failed'
        ids.append(response.json())
    for pid in ids[:2]:
        assert rpc('reserve_budget', {'_pid': pid}).ok, 'Could not reserve initial CA$200'
    summary = rpc('org_budget_summary', {'_org': org}).json()
    assert summary['available_minor'] == 10000, 'Expected exactly CA$100 remaining'
    barrier = threading.Barrier(2)
    def reserve(pid):
        with requests.Session() as client:
            barrier.wait()
            return rpc('reserve_budget', {'_pid': pid}, client).ok
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(reserve, ids[2:]))
    assert sorted(results) == [False, True], 'Two CA$80 requests must not both reserve CA$100'
    summary = rpc('org_budget_summary', {'_org': org}).json()
    assert summary['reserved_minor'] == 28000
    assert summary['available_minor'] == 2000
    print('PASS: concurrent separate HTTP sessions; CA$100 available; one CA$80 reserved, one refused; CA$20 remains.')
finally:
    for pid in ids:
        rpc('cancel_purchase', {'_pid': pid, '_reason': 'Fictional concurrency test completed'})