<?php

namespace App\Enums;

enum UserRole: string
{
    case ADMIN = 'ADMIN';
    case MSME = 'MSME';
    case FIC = 'FIC';
    case CONSUMER = 'CONSUMER';
    case RESEARCHER = 'RESEARCHER';
    case FIC_MANAGER = 'FIC_MANAGER';
}
