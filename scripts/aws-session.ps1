param(
  [Parameter(Mandatory=$true)][ValidateSet('Check','Plan','Apply','Status','Destroy')][string]$Action,
  [switch]$CloudApproved
)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$terraformPath=Join-Path $projectRoot '.local/tools/terraform.exe'
$terraformDirectory=Join-Path $projectRoot 'infra/eks'
$sessionDirectory=Join-Path $projectRoot '.local/aws'
$planPath=Join-Path $sessionDirectory 'approved.tfplan'
$sessionPath=Join-Path $sessionDirectory 'session.json'
function Invoke-Checked($Program,$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed. Stop and inspect before proceeding." }
}
if ($Action -eq 'Check') {
  Invoke-Checked $terraformPath @('version')
  Invoke-Checked 'aws' @('--version')
  Invoke-Checked 'kubectl' @('version','--client')
  Invoke-Checked $terraformPath @("-chdir=$terraformDirectory",'fmt','-check')
  Write-Host 'Local tooling checked. No AWS API calls were made.'
  return
}
if (!$CloudApproved) { throw 'Cloud actions require the user go-ahead and -CloudApproved. No cloud action was taken.' }
if (!(Test-Path (Join-Path $terraformDirectory 'terraform.tfvars'))) { throw 'Fill in the personal account ID and your /32 CIDR in the ignored terraform.tfvars first.' }
New-Item -ItemType Directory -Force $sessionDirectory | Out-Null
if ($Action -eq 'Plan') {
  Invoke-Checked $terraformPath @("-chdir=$terraformDirectory",'init','-input=false')
  Invoke-Checked $terraformPath @("-chdir=$terraformDirectory",'plan','-input=false',"-out=$planPath")
  Write-Host 'Review the saved plan before Apply. No resources have been created by Plan.'
} elseif ($Action -eq 'Apply') {
  if (!(Test-Path $planPath) -or ((Get-Date)-(Get-Item $planPath).LastWriteTime).TotalMinutes -gt 15) { throw 'Create and review a fresh Plan first.' }
  $started=[DateTimeOffset]::UtcNow
  @{ startedAt=$started.ToString('o'); cleanupDueAt=$started.AddMinutes(40).ToString('o'); targetFinishAt=$started.AddMinutes(60).ToString('o') } | ConvertTo-Json | Set-Content $sessionPath
  Write-Host 'Cloud clock started. Begin cleanup by minute 40; AWS creation/deletion times can vary.'
  Invoke-Checked $terraformPath @("-chdir=$terraformDirectory",'apply','-input=false',$planPath)
  $env:KUBECONFIG=Join-Path $projectRoot '.local/k8s/eks-kubeconfig'
  Invoke-Checked 'aws' @('eks','update-kubeconfig','--name','gta-portfolio-demo','--region','us-east-1','--kubeconfig',$env:KUBECONFIG)
  Write-Host 'Cluster is ready. Keep the session clock visible while publishing and deploying tested images.'
} elseif ($Action -eq 'Status') {
  if (Test-Path $sessionPath) { Get-Content $sessionPath }
  Invoke-Checked $terraformPath @("-chdir=$terraformDirectory",'state','list')
} elseif ($Action -eq 'Destroy') {
  Invoke-Checked $terraformPath @("-chdir=$terraformDirectory",'destroy','-input=false','-auto-approve')
  $remaining=& $terraformPath "-chdir=$terraformDirectory" state list
  if ($LASTEXITCODE -ne 0 -or $remaining) { throw 'Tracked resources remain; cleanup is not complete.' }
  if (Test-Path $sessionPath) {
    $session=Get-Content $sessionPath -Raw | ConvertFrom-Json
    $session | Add-Member -NotePropertyName cleanupVerifiedAt -NotePropertyValue ([DateTimeOffset]::UtcNow.ToString('o')) -Force
    $session | ConvertTo-Json | Set-Content $sessionPath
  }
  Write-Host 'Terraform resource cleanup verified. Images in these temporary ECR repositories were deleted with them.'
}
