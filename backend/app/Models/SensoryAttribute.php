<?php

namespace App\Models;

class SensoryAttribute extends PrismaModel
{
    protected $table = 'SensoryAttribute';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'studyId', 'name', 'type', 'order', 'attributeType',
        'sourceAttributeName', 'isCustom', 'jarOptions',
    ];

    protected $casts = [
        'order' => 'integer',
        'isCustom' => 'boolean',
        'jarOptions' => 'json',
    ];

    public function study()
    {
        return $this->belongsTo(Study::class, 'studyId');
    }
}
