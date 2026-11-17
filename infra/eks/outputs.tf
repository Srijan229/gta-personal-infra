output "cluster_name" { value = aws_eks_cluster.demo.name }
output "region" { value = var.region }
output "image_prefix" { value = "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com/${var.name}-" }
output "image_publisher_role_arn" { value = aws_iam_role.image_publisher.arn }
output "managed_node_group" { value = aws_eks_node_group.demo.node_group_name }
