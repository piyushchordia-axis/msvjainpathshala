# ecs-service-ai — FastAPI service for AI workloads.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

resource "aws_iam_role" "exec" {
  name = "${var.name}-ai-exec"
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

resource "aws_security_group" "ai" {
  name        = "${var.name}-ai"
  description = "FastAPI AI service — internal-only, accessed via HMAC from API"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = var.allowed_caller_security_group_ids
    description     = "AI HTTP from API tasks (HMAC-verified)"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name}-ai"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.exec.arn

  container_definitions = jsonencode([{
    name      = "ai"
    image     = var.image
    essential = true
    portMappings = [{
      containerPort = 8000
      hostPort      = 8000
      protocol      = "tcp"
    }]
    environment = [for k, v in var.environment : { name = k, value = v }]
    secrets     = [for k, arn in var.secret_env : { name = k, valueFrom = arn }]
    healthCheck = {
      command  = ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"]
      interval = 30, timeout = 5, retries = 3, startPeriod = 20
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = var.log_group_name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ai"
      }
    }
  }])
}

resource "aws_ecs_service" "this" {
  name            = "${var.name}-ai"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = [aws_security_group.ai.id]
  }
}
