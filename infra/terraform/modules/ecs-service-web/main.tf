# ecs-service-web — Next.js production server.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

resource "aws_iam_role" "exec" {
  name = "${var.name}-web-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "exec" {
  role       = aws_iam_role.exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name}-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.exec.arn

  container_definitions = jsonencode([{
    name      = "web"
    image     = var.image
    essential = true
    portMappings = [{
      containerPort = 3001
      hostPort      = 3001
      protocol      = "tcp"
    }]
    environment = [for k, v in var.environment : { name = k, value = v }]
    healthCheck = {
      command  = ["CMD-SHELL", "wget -qO- http://localhost:3001/api/health || exit 1"]
      interval = 30, timeout = 5, retries = 3, startPeriod = 20
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = var.log_group_name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "web"
      }
    }
  }])
}

resource "aws_ecs_service" "this" {
  name            = "${var.name}-web"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = [var.task_security_group_id]
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "web"
    container_port   = 3001
  }
}
