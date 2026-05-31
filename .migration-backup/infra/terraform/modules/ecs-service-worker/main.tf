# ecs-service-worker — BullMQ worker, scales on custom queue-depth metric.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

resource "aws_iam_role" "exec" {
  name = "${var.name}-worker-exec"
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

resource "aws_iam_role" "task" {
  name = "${var.name}-worker-task"
  assume_role_policy = aws_iam_role.exec.assume_role_policy
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.exec.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "worker"
    image     = var.image
    essential = true
    portMappings = [{
      containerPort = 3100
      hostPort      = 3100
      protocol      = "tcp"
    }]
    environment = [for k, v in var.environment : { name = k, value = v }]
    secrets     = [for k, arn in var.secret_env : { name = k, valueFrom = arn }]
    healthCheck = {
      command  = ["CMD-SHELL", "wget -qO- http://localhost:3100/healthz || exit 1"]
      interval = 30, timeout = 5, retries = 3, startPeriod = 20
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = var.log_group_name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "worker"
      }
    }
    stopTimeout = 30
  }])
}

resource "aws_ecs_service" "this" {
  name            = "${var.name}-worker-${var.queue_group}"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = [var.task_security_group_id]
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  enable_execute_command             = true
}

resource "aws_appautoscaling_target" "queue" {
  max_capacity       = var.max_count
  min_capacity       = var.desired_count
  resource_id        = "service/${var.cluster_name}/${aws_ecs_service.this.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Queue depth published by jp-queue-metrics-publisher Lambda (every 30s).
resource "aws_appautoscaling_policy" "queue_depth" {
  name               = "${var.name}-worker-${var.queue_group}-queue-depth"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.queue.resource_id
  scalable_dimension = aws_appautoscaling_target.queue.scalable_dimension
  service_namespace  = aws_appautoscaling_target.queue.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value = var.target_queue_depth_per_task
    customized_metric_specification {
      metric_name = "QueueDepth"
      namespace   = "JP/Queue"
      statistic   = "Average"
      dimensions {
        name  = "QueueGroup"
        value = var.queue_group
      }
    }
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
