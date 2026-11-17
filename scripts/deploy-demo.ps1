param([switch]$CloudApproved,[switch]$Stop,[string]$NodePath='node')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$work=Join-Path $projectRoot '.local/k8s'
$processFile=Join-Path $work 'tunnel-processes.json'
$env:KUBECONFIG=Join-Path $work 'eks-kubeconfig'
$kubectl=(Get-Command kubectl).Source
function Invoke-Checked($Program,$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed. Inspect the demo logs before proceeding." }
}
function Stop-OwnedTunnels {
  if (!(Test-Path $processFile)) { return }
  foreach ($entry in (Get-Content $processFile -Raw | ConvertFrom-Json)) {
    $owned=Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.pid)"
    if ($owned -and $owned.CommandLine -and $owned.CommandLine.Contains($entry.marker)) { Stop-Process -Id $entry.pid }
  }
  Remove-Item -LiteralPath $processFile
}
if ($Stop) { Stop-OwnedTunnels; Write-Host 'Owned local tunnel processes stopped.'; return }
if (!$CloudApproved) { throw 'Deployment requires the user cloud go-ahead and -CloudApproved.' }
if (!$env:GTA_IMAGE_PREFIX -or !$env:GTA_IMAGE_TAG) { throw 'Set the image prefix and tag from the approved image publisher first.' }
if (!(Test-Path (Join-Path $work 'laptop.env'))) { throw 'Prepare the dedicated local demo database first.' }
if (Test-Path $processFile) { throw 'Stop the previous owned tunnels before starting another deployment.' }
$env:GTA_CLOUD_APPROVED='true'
Set-Location $projectRoot
# guardContext is also enforced by k8s-secrets and k8s-demo. Check here before apply.
$context=& $kubectl config current-context
if ($context -notmatch '^arn:aws:eks:us-east-1:\d{12}:cluster/gta-portfolio-demo$') { throw 'Unexpected Kubernetes context.' }
Invoke-Checked $NodePath @('scripts/render-k8s.mjs')
Invoke-Checked $kubectl @('apply','-f','kubernetes/crd.json')
Invoke-Checked $kubectl @('wait','--for=condition=Established','crd/applicationscalingpolicies.portfolio.gta.dev','--timeout=30s')
Invoke-Checked $kubectl @('apply','-f',(Join-Path $work 'bootstrap.json'))
Invoke-Checked $NodePath @('--env-file=.local/k8s/laptop.env','scripts/k8s-secrets.mjs')
Invoke-Checked $kubectl @('-n','gta-demo','rollout','status','deployment/db-relay','--timeout=120s')
$processes=@()
function Start-Tunnel($Program,$Arguments,$Log,$Marker) {
  $process=Start-Process -FilePath $Program -ArgumentList $Arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $work "$Log.out.log") -RedirectStandardError (Join-Path $work "$Log.error.log")
  $script:processes+=@{pid=$process.Id;marker=$Marker}
  $script:processes | ConvertTo-Json | Set-Content $processFile
}
function Wait-Port($Port) {
  for ($attempt=0;$attempt -lt 30;$attempt++) {
    $tcp=New-Object Net.Sockets.TcpClient
    try { $tcp.Connect('127.0.0.1',$Port); $tcp.Close(); return } catch { $tcp.Dispose(); Start-Sleep -Seconds 1 }
  }
  throw "Port $Port did not become available. Inspect ignored tunnel logs."
}
foreach ($port in @(2222,18088)) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port $port is already occupied." }
}
try {
  Start-Tunnel $kubectl @("--kubeconfig=`"$env:KUBECONFIG`"",'-n','gta-demo','port-forward','service/db-relay','2222:2222','--address=127.0.0.1') 'relay-forward' $env:KUBECONFIG
  Wait-Port 2222
  $ssh=(Get-Command ssh).Source
  $key=Join-Path $work 'client_key'
  $known=Join-Path $work 'known_hosts'
  Start-Tunnel $ssh @('-N','-p','2222','-i',"`"$key`"",'-o',"UserKnownHostsFile=`"$known`"",'-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=3','-R','0.0.0.0:5432:127.0.0.1:5432','demo@127.0.0.1') 'database-ssh' $key
  $relayReady=$false
  for ($attempt=0;$attempt -lt 20;$attempt++) {
    & $kubectl -n gta-demo exec deployment/db-relay -- nc -z 127.0.0.1 5432 2>$null
    if ($LASTEXITCODE -eq 0) { $relayReady=$true; break }
    Start-Sleep -Seconds 1
  }
  if (!$relayReady) { throw 'The reverse database tunnel did not start.' }
  Invoke-Checked $kubectl @('-n','gta-demo','delete','job','migrate','--ignore-not-found')
  Invoke-Checked $kubectl @('apply','-f',(Join-Path $work 'migration.json'))
  Invoke-Checked $kubectl @('-n','gta-demo','wait','--for=condition=complete','job/migrate','--timeout=180s')
  Invoke-Checked $kubectl @('apply','-f',(Join-Path $work 'app.json'))
  Invoke-Checked $kubectl @('apply','-f','https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.9.1/components.yaml')
  foreach ($component in @('backend','frontend','controller')) { Invoke-Checked $kubectl @('-n','gta-demo','rollout','status',"deployment/$component",'--timeout=180s') }
  Invoke-Checked $kubectl @('-n','kube-system','rollout','status','deployment/metrics-server','--timeout=120s')
  Start-Tunnel $kubectl @("--kubeconfig=`"$env:KUBECONFIG`"",'-n','gta-demo','port-forward','service/frontend','18088:8080','--address=127.0.0.1') 'web-forward' $env:KUBECONFIG
  Wait-Port 18088
  Write-Host 'Private demo ready at http://127.0.0.1:18088. Keep this laptop online for PostgreSQL.'
} catch { Stop-OwnedTunnels; throw }
