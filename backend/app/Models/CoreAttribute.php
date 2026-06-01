<?php

namespace App\Models;

/**
 * Table: attributes (via Prisma @@map)
 */
class CoreAttribute extends PrismaModel
{
    protected $table = 'attributes';

    public $incrementing = false;
    protected $keyType = 'string';
    protected $primaryKey = 'attribute_id';
    public $timestamps = false;

    protected $fillable = [
        'attribute_id', 'test_id', 'attribute_name', 'category',
        'attribute_type', 'is_custom', 'created_at', 'updated_at',
    ];

    protected $casts = [
        'is_custom' => 'boolean',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function study()
    {
        return $this->belongsTo(Study::class, 'test_id', 'id');
    }

    public function questions()
    {
        return $this->hasMany(SensoryQuestion::class, 'attribute_id', 'attribute_id');
    }

    public function metrics()
    {
        return $this->hasMany(DerivedMetric::class, 'attribute_id', 'attribute_id');
    }
}
