# alb — Application Load Balancer in front of ECS api + web services.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "ALB — public 443 ingress"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Redirect to 443"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}

resource "aws_lb" "this" {
  name               = "${var.name}-alb"
  load_balancer_type = "application"
  subnets            = var.public_subnet_ids
  security_groups    = [aws_security_group.alb.id]
  idle_timeout       = 60
  enable_http2       = true
  drop_invalid_header_fields = true
  tags               = var.tags
}

resource "aws_lb_listener" "redirect_http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  condition {
    host_header {
      values = var.api_hostnames
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_target_group" "api" {
  name        = "${var.name}-api"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id
  health_check {
    path                = "/healthz"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }
  deregistration_delay = 30
  tags                 = var.tags
}

resource "aws_lb_target_group" "web" {
  name        = "${var.name}-web"
  port        = 3001
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id
  health_check {
    path                = "/api/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }
  deregistration_delay = 30
  tags                 = var.tags
}
