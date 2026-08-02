$ErrorActionPreference = "Stop"
$Base = "http://127.0.0.1:8080"
$BalBatch = "d403d73d-8c20-4bbd-8c5f-e0b5768e00b2"
$KishorBatch = "2f1a68a0-3d88-4fdc-91f2-4baa667155fb"
$AaravId = "66b9c256-88b6-43bd-afc7-77807e506198"
$Shik2Id = "598d2582-3a09-40ee-8b7f-04312d3969e2"
$Tmp = Join-Path $env:TEMP "jp-lifecycle"
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

function New-Ulid {
  $crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  -join (1..26 | ForEach-Object { $crockford[(Get-Random -Maximum 32)] })
}

function Login([string]$phone) {
  $send = Invoke-RestMethod -Method POST -Uri "$Base/api/auth/login" -ContentType "application/json" -Body (@{ phase = "send"; phone = $phone } | ConvertTo-Json)
  $otp = if ($send.data.dev_code) { $send.data.dev_code } else { "123456" }
  $verify = Invoke-RestMethod -Method POST -Uri "$Base/api/auth/login" -ContentType "application/json" -Body (@{
    phase = "verify"; otp_token = $send.data.otp_token; code = $otp; device_id = "demo-lifecycle"
  } | ConvertTo-Json)
  return $verify.data.tokens.access_token
}

function Show([string]$label, [string]$out) {
  Write-Host "`n=== $label ===" -ForegroundColor Cyan
  Write-Host $out
}

function CurlReq([string]$method, [string]$path, [string]$token, $bodyObj = $null) {
  $args = @("-s", "-w", "`nHTTP %{http_code}", "-X", $method, "$Base$path", "-H", "Authorization: Bearer $token", "-H", "Content-Type: application/json")
  if ($null -ne $bodyObj) {
    $file = Join-Path $Tmp ("body-" + [guid]::NewGuid().ToString() + ".json")
    [System.IO.File]::WriteAllText($file, ($bodyObj | ConvertTo-Json -Depth 8 -Compress))
    $args += @("--data-binary", "@$file")
  }
  return (& curl.exe @args)
}

$superToken = Login "+919800000001"
$shikToken = Login "+919800000005"
$shik2Token = Login "+919800000014"

# Ensure attendance feature points exist (AT21).
docker exec jp-postgres psql -U jp -d jainpathshala -c "insert into punya_features (key, label, is_active, min_points, max_points) select 'attendance','Attendance', true, 0, 10 where not exists (select 1 from punya_features where key='attendance');" | Out-Null

$centresRaw = CurlReq GET "/v1/admin/centres" $superToken
$centres = ($centresRaw -split "`nHTTP ")[0] | ConvertFrom-Json
$ghat = $centres.data.items | Where-Object { $_.name -like "Ghatkopar*" } | Select-Object -First 1
$null = CurlReq POST "/v1/admin/centres/$($ghat.id)/shikshaks" $superToken @{ user_id = $Shik2Id }
$null = CurlReq POST "/v1/admin/batches/$BalBatch/shikshaks" $superToken @{ user_id = $Shik2Id }

docker exec jp-postgres psql -U jp -d jainpathshala -c "delete from attendance where session_id in (select id from sessions where batch_id in ('$BalBatch','$KishorBatch') and scheduled_date = current_date); delete from sessions where batch_id in ('$BalBatch','$KishorBatch') and scheduled_date = current_date;" | Out-Null

Show "1. materialise" (CurlReq POST "/v1/admin/sessions/materialise" $superToken @{})

$todayRaw = CurlReq GET "/v1/sessions/today" $shikToken
Show "today" $todayRaw
$today = ($todayRaw -split "`nHTTP ")[0] | ConvertFrom-Json
$sessionBal = $today.data.items | Where-Object { $_.batch_id -eq $BalBatch } | Select-Object -First 1
$sessionKishor = $today.data.items | Where-Object { $_.batch_id -eq $KishorBatch } | Select-Object -First 1
if (-not $sessionBal -or -not $sessionKishor) { throw "Missing today's sessions" }

$op1 = New-Ulid
Show "2. check-in in-radius" (CurlReq POST "/v1/sessions/$($sessionBal.id)/check-in" $shikToken @{
  submission_op_id = $op1; lat = 19.0861; lng = 72.9081; accuracy_m = 12
})

Show "3. check-in out-of-radius (flagged)" (CurlReq POST "/v1/sessions/$($sessionKishor.id)/check-in" $shikToken @{
  submission_op_id = (New-Ulid); lat = 18.5204; lng = 73.8567; accuracy_m = 15
})

Show "4. duplicate check-in same submission_op_id" (CurlReq POST "/v1/sessions/$($sessionBal.id)/check-in" $shikToken @{
  submission_op_id = $op1; lat = 19.0861; lng = 72.9081; accuracy_m = 12
})

Show "5. other shikshak check-in" (CurlReq POST "/v1/sessions/$($sessionBal.id)/check-in" $shik2Token @{
  submission_op_id = (New-Ulid); lat = 19.0861; lng = 72.9081; accuracy_m = 12
})

$null = CurlReq POST "/v1/sessions/$($sessionKishor.id)/check-out" $shikToken @{
  lat = 18.5204; lng = 73.8567; accuracy_m = 20
}
docker exec jp-postgres psql -U jp -d jainpathshala -c "delete from sessions where id = '$($sessionKishor.id)';" | Out-Null

Show "6. soft-create unscheduled=true" (CurlReq POST "/v1/sessions/00000000-0000-4000-8000-000000000099/check-in" $shikToken @{
  submission_op_id = (New-Ulid); batch_id = $KishorBatch; lat = 19.0861; lng = 72.9081; accuracy_m = 18
})

Show "7. check-out" (CurlReq POST "/v1/sessions/$($sessionBal.id)/check-out" $shikToken @{
  lat = 19.0862; lng = 72.9082; accuracy_m = 10
})

Show "7b. mark attendance" (CurlReq POST "/v1/sessions/$($sessionBal.id)/attendance" $shikToken @{
  submission_op_id = (New-Ulid)
  marked_at = (Get-Date).ToUniversalTime().ToString("o")
  marks = @(@{ student_id = $AaravId; status = "present"; client_op_id = (New-Ulid) })
})

Show "8. cancel with marks (rejected)" (CurlReq POST "/v1/sessions/$($sessionBal.id)/cancel" $shikToken @{
  reason = "Need to cancel after marks were taken"
})

$before = (docker exec jp-postgres psql -U jp -d jainpathshala -t -A -c "select coalesce((select total_points from punya_balances where student_id='$AaravId'),0);").Trim()
$ledgerBefore = docker exec jp-postgres psql -U jp -d jainpathshala -c "select points, idempotency_key, reversal_of is not null as is_rev from punya_transactions where student_id='$AaravId' and source_entity_id='$($sessionBal.id)'::uuid order by created_at;"

Show "9. force_cancel" (CurlReq POST "/v1/sessions/$($sessionBal.id)/cancel" $shikToken @{
  reason = "Force cancel after marks were taken"
  force_cancel = $true
})

$after = (docker exec jp-postgres psql -U jp -d jainpathshala -t -A -c "select coalesce((select total_points from punya_balances where student_id='$AaravId'),0);").Trim()
$ledgerAfter = docker exec jp-postgres psql -U jp -d jainpathshala -c "select points, idempotency_key, reversal_of is not null as is_rev from punya_transactions where student_id='$AaravId' and source_entity_id='$($sessionBal.id)'::uuid order by created_at;"
Show "9b. punya balance + ledger" "balance_before=$before`nbalance_after=$after`n`nLEDGER BEFORE:`n$ledgerBefore`nLEDGER AFTER:`n$ledgerAfter"

Write-Host "`nDone." -ForegroundColor Green
