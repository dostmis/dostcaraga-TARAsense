<?php

namespace App\Models;

use App\Support\Cuid;
use Illuminate\Database\Eloquent\Model;

abstract class PrismaModel extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected static function booted(): void
    {
        static::creating(function (Model $model): void {
            $key = $model->getKeyName();

            if (!$model->getAttribute($key)) {
                $model->setAttribute($key, Cuid::make());
            }

            $now = now();

            if ($model->isFillable('createdAt') && !$model->getAttribute('createdAt')) {
                $model->setAttribute('createdAt', $now);
            }

            if ($model->isFillable('updatedAt') && !$model->getAttribute('updatedAt')) {
                $model->setAttribute('updatedAt', $now);
            }

            if ($model->isFillable('created_at') && !$model->getAttribute('created_at')) {
                $model->setAttribute('created_at', $now);
            }

            if ($model->isFillable('updated_at') && !$model->getAttribute('updated_at')) {
                $model->setAttribute('updated_at', $now);
            }
        });

        static::updating(function (Model $model): void {
            if ($model->isFillable('updatedAt')) {
                $model->setAttribute('updatedAt', now());
            }

            if ($model->isFillable('updated_at')) {
                $model->setAttribute('updated_at', now());
            }
        });
    }
}
