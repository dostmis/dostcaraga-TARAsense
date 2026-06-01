<?php

namespace App\Models;

/**
 * Table: derived_metrics (via Prisma @@map)
 */
class DerivedMetric extends PrismaModel
{
    protected $table = 'derived_metrics';

    public $incrementing = false;
    protected $keyType = 'string';
    protected $primaryKey = 'metric_id';
    public $timestamps = false;

    protected $fillable = [
        'metric_id', 'test_id', 'attribute_id', 'metric_type',
        'value', 'created_at', 'updated_at',
    ];

    protected $casts = [
        'value' => 'json',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function study()
    {
        return $this->belongsTo(Study::class, 'test_id', 'id');
    }

    public function attribute()
    {
        return $this->belongsTo(CoreAttribute::class, 'attribute_id', 'attribute_id');
    }
}
